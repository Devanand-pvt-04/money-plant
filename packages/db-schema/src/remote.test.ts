import { describe, expect, it } from 'vitest';
import {
  fromRemoteBudget,
  fromRemoteRecurring,
  fromRemoteDeposit,
  fromRemoteHolding,
  toRemoteHolding,
  toRemoteDeposit,
  toRemoteRecurring,
  fromRemoteRule,
  toRemoteBudget,
  toRemoteRule,
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
  account_type_id: null,
  parent_id: null,
  category_key: null,
  vpa: null,
  email: null,
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
    categoryReason: 'user',
    categoryRuleId: null,
    userSetFields: '["category"]',
    note: 'Team lunch',
    splitGroupId: 'group-1',
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
    expect(payload).toMatchObject({ category_reason: 'user', user_set_fields: ['category'], note: 'Team lunch', split_group_id: 'group-1' });
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
      category_reason: 'dictionary',
      category_rule_id: null,
      user_set_fields: ['counterparty'],
      note: null,
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
    expect(pulled.transaction.userSetFields).toBe('["counterparty"]');
    // Rows from before group expenses have no split_group_id.
    expect(pulled.transaction.splitGroupId).toBeNull();
  });
});

describe('budget mapping', () => {
  it('stores months as the first day of the month on the server', () => {
    const local = {
      id: 'b-1',
      month: '2026-10',
      categoryAccountId: null,
      limitPaise: 5000000,
      createdAt: '2026-10-22T10:00:00.000Z',
      updatedAt: null,
      deletedAt: null,
      dirty: 1,
      rev: 0,
    };
    const remote = toRemoteBudget(local);
    expect(remote.month).toBe('2026-10-01');
    const back = fromRemoteBudget({ ...remote, user_id: 'u', updated_at: '2026-10-22T10:00:01+00:00', limit_paise: '5000000' as unknown as number });
    expect(back).toMatchObject({ month: '2026-10', limitPaise: 5000000, dirty: 0 });
  });

  it('keeps a default budget without a month', () => {
    const remote = toRemoteBudget({ id: 'b-2', month: null, categoryAccountId: 'food', limitPaise: 300000, createdAt: '2026-10-22T10:00:00.000Z', updatedAt: null, deletedAt: null, dirty: 1, rev: 0 });
    expect(remote.month).toBeNull();
    expect(fromRemoteBudget({ ...remote, user_id: 'u', updated_at: '2026-10-22T10:00:01+00:00' }).month).toBeNull();
  });
});

describe('rule mapping', () => {
  it('sends match as JSON and booleans as booleans', () => {
    const remote = toRemoteRule({
      id: 'r-1',
      kind: 'pattern',
      status: 'proposed',
      match: '{"kind":"pattern","minAmount":1500}',
      categoryAccountId: 'cat',
      autoConfirm: 0,
      hits: 2,
      misses: 0,
      createdAt: '2026-10-22T10:00:00.000Z',
      updatedAt: null,
      deletedAt: null,
      dirty: 1,
      rev: 0,
    });
    expect(remote).toMatchObject({ match: { kind: 'pattern', minAmount: 1500 }, auto_confirm: false });
    expect(fromRemoteRule({ ...remote, user_id: 'u', updated_at: 'x' }).match).toBe('{"kind":"pattern","minAmount":1500}');
  });
});

describe('recurring mapping', () => {
  it('keeps the due date as a plain date and amounts as integers', () => {
    const local = {
      id: 'rec-1',
      name: 'Netflix',
      vpa: null,
      merchant: 'netflix',
      amountPaise: 64900,
      cadence: 'monthly' as const,
      anchorDay: 25,
      nextDue: '2026-10-25',
      accountId: 'card',
      categoryAccountId: null,
      status: 'active' as const,
      origin: 'pre_debit' as const,
      mandateRef: 'SI1234567890',
      lastPaidAt: '2026-09-25T06:30:00.000Z',
      lastTransactionId: 'tx-1',
      createdAt: '2026-10-23T10:00:00.000Z',
      updatedAt: null,
      deletedAt: null,
      dirty: 1,
      rev: 3,
    };
    const remote = toRemoteRecurring(local);
    expect(remote).toMatchObject({ next_due: '2026-10-25', amount_paise: 64900, anchor_day: 25 });
    const back = fromRemoteRecurring({
      ...remote,
      user_id: 'u',
      updated_at: '2026-10-23T10:00:01+00:00',
      amount_paise: '64900' as unknown as number,
      last_paid_at: '2026-09-25T06:30:00+00:00',
    });
    expect(back).toEqual({ ...local, updatedAt: '2026-10-23T10:00:01+00:00', dirty: 0, rev: 0 });
  });
});

describe('deposit mapping', () => {
  it('keeps dates plain and the rate and amount as integers', () => {
    const local = {
      id: 'dep-1',
      accountId: 'rd-account',
      kind: 'rd' as const,
      amountPaise: 1_200_000,
      rateBp: 750,
      startDate: '2026-04-01',
      maturityDate: '2027-04-01',
      payout: 'reinvest' as const,
      paidFromAccountId: 'icici',
      payee: 'SHIVALIK',
      closedAt: null,
      createdAt: '2026-10-25T10:00:00.000Z',
      updatedAt: null,
      deletedAt: null,
      dirty: 1,
      rev: 2,
    };
    const remote = toRemoteDeposit(local);
    expect(remote).toMatchObject({ amount_paise: 1_200_000, rate_bp: 750, start_date: '2026-04-01', payee: 'SHIVALIK' });
    const back = fromRemoteDeposit({
      ...remote,
      user_id: 'u',
      updated_at: '2026-10-25T10:00:01+00:00',
      amount_paise: '1200000' as unknown as number,
      created_at: '2026-10-25T10:00:00+00:00',
    });
    expect(back).toEqual({ ...local, updatedAt: '2026-10-25T10:00:01+00:00', dirty: 0, rev: 0 });
  });
});

describe('holding mapping', () => {
  it('turns bigint strings back into numbers and keeps nulls', () => {
    const local = {
      id: 'h-1',
      accountId: 'fund-account',
      scheme: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
      isin: 'INF879O01027',
      amfiCode: '122639',
      folio: '12345678',
      amc: 'PPFAS Mutual Fund',
      unitsE4: 1_234_560,
      costPaise: 5_000_000,
      navE4: 812_345,
      navDate: '2026-09-30',
      asOf: '2026-09-30',
      sipPaise: null,
      sipDay: null,
      createdAt: '2026-10-25T10:00:00.000Z',
      updatedAt: null,
      deletedAt: null,
      dirty: 1,
      rev: 1,
    };
    const remote = toRemoteHolding(local);
    expect(remote).toMatchObject({ units_e4: 1_234_560, amfi_code: '122639', as_of: '2026-09-30', sip_paise: null });
    const back = fromRemoteHolding({
      ...remote,
      user_id: 'u',
      updated_at: '2026-10-25T10:00:01+00:00',
      units_e4: '1234560' as unknown as number,
      nav_e4: '812345' as unknown as number,
      created_at: '2026-10-25T10:00:00+00:00',
    });
    expect(back).toEqual({ ...local, updatedAt: '2026-10-25T10:00:01+00:00', dirty: 0, rev: 0 });
  });
});
