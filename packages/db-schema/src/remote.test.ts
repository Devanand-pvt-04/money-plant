import { describe, expect, it } from 'vitest';
import {
  fromRemoteAccount,
  fromRemoteTransaction,
  nextCursor,
  toRemoteAccount,
  toTransactionPush,
  type RemoteAccount,
} from './remote';

const remote: RemoteAccount = {
  id: '6f1c2a3e-0000-4000-8000-000000000001',
  user_id: 'user-1',
  type: 'bank',
  name: 'HDFC savings',
  institution: 'HDFC Bank',
  last4: '1234',
  currency: 'INR',
  opening_balance_paise: 1250000,
  created_at: '2026-10-21T10:00:00.000Z',
  updated_at: '2026-10-21T10:05:00.000Z',
  deleted_at: null,
};

describe('account mapping', () => {
  it('round-trips through the local shape without server-owned fields', () => {
    const local = fromRemoteAccount(remote);
    expect(local.dirty).toBe(0);
    expect(local.openingBalancePaise).toBe(1250000);
    const write = toRemoteAccount(local);
    expect(write).not.toHaveProperty('user_id');
    expect(write).not.toHaveProperty('updated_at');
    expect(write.name).toBe('HDFC savings');
  });

  it('accepts bigint columns returned as strings', () => {
    const local = fromRemoteAccount({
      ...remote,
      opening_balance_paise: '900' as unknown as number,
    });
    expect(local.openingBalancePaise).toBe(900);
  });
});

describe('nextCursor', () => {
  it('keeps the latest timestamp', () => {
    const rows = [
      { ...remote, updated_at: '2026-10-21T10:05:00.000Z' },
      { ...remote, updated_at: '2026-10-21T11:00:00+00:00' },
      { ...remote, updated_at: '2026-10-21T09:00:00.000Z' },
    ];
    expect(nextCursor(rows, '2026-10-20T00:00:00.000Z')).toBe('2026-10-21T11:00:00+00:00');
  });

  it('keeps the previous cursor when nothing is newer', () => {
    expect(nextCursor([], '2026-10-20T00:00:00.000Z')).toBe('2026-10-20T00:00:00.000Z');
    expect(nextCursor([], null)).toBeNull();
  });
});

describe('transaction push', () => {
  const tx = {
    id: 'tx-1',
    occurredAt: '2026-10-21T10:00:00.000Z',
    counterparty: 'SWIGGY',
    kind: 'expense' as const,
    status: 'confirmed' as const,
    confidence: 0.95,
    reviewReason: null,
    createdAt: '2026-10-21T10:00:01.000Z',
    updatedAt: null,
    deletedAt: null,
    dirty: 1,
    rev: 3,
  };
  const postingRows = [
    { id: 'p-1', transactionId: 'tx-1', accountId: 'hdfc', amountPaise: -45000, createdAt: tx.createdAt },
    { id: 'p-2', transactionId: 'tx-1', accountId: 'food', amountPaise: 45000, createdAt: tx.createdAt },
  ];
  const sourceRows = [
    {
      id: 's-1',
      transactionId: 'tx-1',
      kind: 'sms',
      sender: 'HDFCBK',
      externalRef: '629412345678',
      fingerprint: 'abc',
      parsedFields: JSON.stringify({ amount: 45000, direction: 'debit' }),
      receivedAt: tx.occurredAt,
      confidence: 0.95,
      rawText: 'Sent Rs.450.00 From HDFC Bank A/C *1234 To SWIGGY',
      createdAt: tx.createdAt,
    },
  ];

  it('never includes the raw message text', () => {
    const payload = toTransactionPush(tx, postingRows, sourceRows);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('raw');
    expect(json).not.toContain('Sent Rs.450.00');
    expect(payload.sources[0]!.parsed_fields).toEqual({ amount: 45000, direction: 'debit' });
  });

  it('round-trips a pulled transaction, dropping deleted postings', () => {
    const pulled = fromRemoteTransaction({
      id: 'tx-1',
      user_id: 'user-1',
      occurred_at: tx.occurredAt,
      counterparty: 'SWIGGY',
      kind: 'expense',
      status: 'confirmed',
      confidence: 0.95,
      review_reason: null,
      created_at: tx.createdAt,
      updated_at: '2026-10-21T10:05:00.000Z',
      deleted_at: null,
      postings: [
        { id: 'p-1', transaction_id: 'tx-1', account_id: 'hdfc', amount_paise: '-45000' as unknown as number, created_at: tx.createdAt, deleted_at: null },
        { id: 'p-2', transaction_id: 'tx-1', account_id: 'food', amount_paise: 45000, created_at: tx.createdAt, deleted_at: null },
        { id: 'p-old', transaction_id: 'tx-1', account_id: 'misc', amount_paise: 45000, created_at: tx.createdAt, deleted_at: '2026-10-21T10:04:00.000Z' },
      ],
      sources: [],
    });
    expect(pulled.postings.map((p) => p.amountPaise)).toEqual([-45000, 45000]);
    expect(pulled.transaction.dirty).toBe(0);
  });
});
