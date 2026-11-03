import { describe, expect, it } from 'vitest';
import { paise } from '@money-plant/core';
import { normaliseSender, parseSms } from '@money-plant/parser';
import { MemoryStore } from './memory-store';
import { ingestSms, type PipelineContext } from './pipeline';
import { findRefunded } from './refunds';
import type { LedgerTransaction } from './types';

const payment = (id: string, occurredAt: string, amount: number, counterparty: string | null, accountId = 'bank'): LedgerTransaction => ({
  id,
  occurredAt,
  counterparty,
  kind: 'expense',
  status: 'confirmed',
  confidence: 1,
  reviewReason: null,
  categoryReason: null,
  categoryRuleId: null,
  userSetFields: [],
  note: null,
  postings: [
    { id: `${id}-a`, accountId, amount: paise(-amount) },
    { id: `${id}-b`, accountId: 'food', amount: paise(amount) },
  ],
  sources: [],
});

const refund = { accountId: 'bank', amount: paise(45_000), counterparty: 'REFUND-SWIGGY', occurredAt: '2026-10-25T10:00:00.000Z' };

describe('findRefunded (LED-5)', () => {
  it('prefers the same payee, then the exact amount, then the latest', () => {
    const older = payment('older', '2026-10-01T10:00:00.000Z', 45_000, 'SWIGGY');
    const newer = payment('newer', '2026-10-20T10:00:00.000Z', 45_000, 'SWIGGY');
    const bigger = payment('bigger', '2026-10-22T10:00:00.000Z', 90_000, 'Swiggy Instamart');
    const other = payment('other', '2026-10-24T10:00:00.000Z', 45_000, 'ZOMATO');
    expect(findRefunded(refund, [older, newer, bigger, other])?.id).toBe('newer');
    expect(findRefunded({ ...refund, counterparty: null }, [older, other])?.id).toBe('other');
  });

  it('needs the same payee or the exact amount, from the same account, within 60 days', () => {
    expect(findRefunded(refund, [payment('p', '2026-10-20T10:00:00.000Z', 60_000, 'ZOMATO')])).toBeNull();
    expect(findRefunded(refund, [payment('p', '2026-10-20T10:00:00.000Z', 45_000, 'SWIGGY', 'card')])).toBeNull();
    expect(findRefunded(refund, [payment('p', '2026-08-01T10:00:00.000Z', 45_000, 'SWIGGY')])).toBeNull();
    expect(findRefunded(refund, [payment('p', '2026-10-20T10:00:00.000Z', 30_000, 'SWIGGY')])).toBeNull();
    expect(findRefunded(refund, [payment('p', '2026-10-26T10:00:00.000Z', 45_000, 'SWIGGY')])).toBeNull();
  });
});

describe('refunds in the pipeline', () => {
  it('gives a refund the category of the card payment it reverses', async () => {
    const store = new MemoryStore();
    let n = 0;
    const ctx: PipelineContext = { store, newId: () => `id-${n++}` };
    const sms = async (sender: string, body: string, receivedAt: string) => {
      const result = parseSms({ sender, body });
      if (result.status !== 'parsed') throw new Error(`not parsed: ${result.status}`);
      const out = await ingestSms(ctx, { parsed: result.transaction, sender: normaliseSender(sender), receivedAt, fingerprint: `${receivedAt}`, rawText: body });
      if (!('transactionId' in out)) throw new Error(out.outcome);
      return out;
    };
    await store.createAccount({ id: 'food', type: 'category', name: 'Food', institution: null, last4: null });
    const spent = await sms(
      'VM-ICICIT',
      'INR 450.00 spent using ICICI Bank Card XX5678 on 21-Oct-26 on SWIGGY. Avl Limit: INR 98,701.00. If not you, call 1800 2662/SMS BLOCK 5678 to 9215676766',
      '2026-10-21T10:00:00.000Z',
    );
    const payment = store.transactions.get(spent.transactionId!)!;
    payment.postings[1]!.accountId = 'food';

    const back = await sms('VM-ICICIT', 'Dear Customer, Rs 450.00 reversed to your ICICI Bank Card XX5678 on 22-Oct-26 for SWIGGY. Avl Limit: INR 99,151.00.', '2026-10-22T10:00:00.000Z');
    expect(store.transactions.get(back.transactionId!)).toMatchObject({
      kind: 'income',
      // A generic parse (no bank template yet) still waits for a look in Review.
      status: 'pending',
      reviewReason: 'low_confidence',
      counterparty: 'SWIGGY',
      categoryReason: 'refund',
      categoryRuleId: payment.id,
      postings: [{ amount: 45_000 }, { accountId: 'food', amount: -45_000 }],
    });
  });
});
