import { describe, expect, it } from 'vitest';
import { paise } from '@money-plant/core';
import { parsePreDebitText } from '@money-plant/parser';
import { applyPreDebit, debitOf, detectRecurring, dueState, settleRecurring, shortfall, type Debit, type RecurringPayment } from './recurring';
import type { LedgerTransaction } from './types';

/** Local noon on a date, so the local day is the same in any test time zone. */
const at = (date: string) => new Date(`${date}T12:00:00`).toISOString();

let n = 0;
const debit = (date: string, rupees: number, payee: { merchant?: string; vpa?: string; label?: string } = {}): Debit => ({
  transactionId: `tx-${n++}`,
  occurredAt: at(date),
  amount: paise(rupees * 100),
  label: payee.label ?? payee.merchant ?? null,
  vpa: payee.vpa ?? null,
  merchant: payee.merchant ?? null,
  accountId: 'hdfc',
  categoryId: 'subscriptions',
});

const netflix: RecurringPayment = {
  id: 'r1',
  name: 'Netflix',
  vpa: null,
  merchant: 'netflix',
  amount: paise(64900),
  cadence: 'monthly',
  anchorDay: 25,
  nextDue: '2026-10-25',
  accountId: 'card',
  categoryId: null,
  status: 'active',
  origin: 'manual',
  mandateRef: null,
  lastPaidAt: null,
  lastTransactionId: null,
};

describe('settleRecurring (REC-4)', () => {
  it('marks the occurrence paid and moves the due date a month on', () => {
    const paid = debit('2026-10-24', 649, { merchant: 'netflix com' });
    const { item, paid: used } = settleRecurring(netflix, [paid]);
    expect(used).toEqual([paid]);
    expect(item).toMatchObject({ nextDue: '2026-11-25', lastTransactionId: paid.transactionId });
  });

  it('catches up several months from an import, and is idempotent', () => {
    const debits = [debit('2026-08-25', 649, { merchant: 'netflix' }), debit('2026-09-26', 649, { merchant: 'netflix' })];
    const first = settleRecurring({ ...netflix, nextDue: '2026-08-25' }, debits);
    expect(first.paid).toHaveLength(2);
    expect(first.item.nextDue).toBe('2026-10-25');
    expect(settleRecurring(first.item, debits).paid).toHaveLength(0);
  });

  it('ignores debits outside 3 days or 10% of the amount, or to another payee', () => {
    const debits = [
      debit('2026-10-20', 649, { merchant: 'netflix' }),
      debit('2026-10-25', 799, { merchant: 'netflix' }),
      debit('2026-10-25', 649, { merchant: 'hotstar' }),
    ];
    expect(settleRecurring(netflix, debits).paid).toHaveLength(0);
  });

  it('matches by UPI ID when both sides have one', () => {
    const rent = { ...netflix, name: 'Rent', merchant: 'ravi kumar', vpa: 'ravi@okicici', amount: paise(2000000), nextDue: '2026-11-01', anchorDay: 1 };
    expect(settleRecurring(rent, [debit('2026-10-31', 20000, { vpa: 'ravi@okicici', merchant: 'ravi' })]).paid).toHaveLength(1);
    expect(settleRecurring(rent, [debit('2026-10-31', 20000, { vpa: 'other@okicici', merchant: 'ravi kumar' })]).paid).toHaveLength(0);
  });

  it('leaves paused and proposed payments alone', () => {
    const paid = debit('2026-10-25', 649, { merchant: 'netflix' });
    expect(settleRecurring({ ...netflix, status: 'paused' }, [paid]).paid).toHaveLength(0);
    expect(settleRecurring({ ...netflix, status: 'proposed' }, [paid]).paid).toHaveLength(0);
  });
});

describe('detectRecurring (REC-1)', () => {
  it('finds a monthly subscription', () => {
    const debits = ['2026-07-05', '2026-08-05', '2026-09-04', '2026-10-05'].map((d) => debit(d, 199, { merchant: 'spotify', label: 'SPOTIFY' }));
    const [proposal, ...rest] = detectRecurring(debits, [], '2026-10-23');
    expect(rest).toHaveLength(0);
    expect(proposal).toMatchObject({ name: 'SPOTIFY', cadence: 'monthly', amount: 19900, anchorDay: 5, nextDue: '2026-11-05' });
  });

  it('skips merchants paid at random, changing amounts, stale ones and known ones', () => {
    const swiggy = ['2026-10-01', '2026-10-03', '2026-10-20'].map((d) => debit(d, 300, { merchant: 'swiggy' }));
    const electricity = [['2026-07-10', 900], ['2026-08-10', 1400], ['2026-09-10', 2100]].map(([d, r]) => debit(d as string, r as number, { merchant: 'bescom' }));
    const old = ['2026-03-01', '2026-04-01', '2026-05-01'].map((d) => debit(d, 99, { merchant: 'old app' }));
    const known = ['2026-08-25', '2026-09-25', '2026-10-25'].map((d) => debit(d, 649, { merchant: 'netflix' }));
    expect(detectRecurring([...swiggy, ...electricity, ...old, ...known], [netflix], '2026-10-26')).toEqual([]);
  });

  it('finds weekly payments after four weeks', () => {
    const debits = ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22'].map((d) => debit(d, 500, { vpa: 'maid@ybl' }));
    expect(detectRecurring(debits, [], '2026-10-23')[0]).toMatchObject({ cadence: 'weekly', anchorDay: null, nextDue: '2026-10-29' });
  });
});

describe('applyPreDebit (REC-1)', () => {
  const now = new Date(2026, 9, 23, 10);
  const notice = parsePreDebitText('hdfc', 'Rs.699.00 will be debited from your HDFC Bank Credit Card ending 5678 on 25-10-2026 towards NETFLIX. SI ID: SI1234567890', now)!;

  it('updates the matching payment with the bank’s date and amount', () => {
    const result = applyPreDebit([{ ...netflix, nextDue: '2026-10-24' }], notice, 'card');
    expect(result).toEqual({ update: expect.objectContaining({ id: 'r1', nextDue: '2026-10-25', amount: 69900, mandateRef: 'SI1234567890' }) });
  });

  it('starts tracking a new autopay', () => {
    const result = applyPreDebit([], notice, 'card');
    expect(result).toEqual({
      create: expect.objectContaining({ name: 'NETFLIX', merchant: 'netflix', status: 'active', origin: 'pre_debit', cadence: 'monthly', anchorDay: 25, accountId: 'card' }),
    });
  });

  it('turns a suggestion into a tracked payment, and skips a notice for an occurrence already paid', () => {
    expect(applyPreDebit([{ ...netflix, status: 'proposed' }], notice, null)).toEqual({ update: expect.objectContaining({ status: 'active' }) });
    expect(applyPreDebit([{ ...netflix, lastPaidAt: at('2026-10-25') }], notice, null)).toBeNull();
  });
});

describe('debitOf and dueState', () => {
  it('reads an SMS expense as a debit with its UPI ID', () => {
    const tx: LedgerTransaction = {
      id: 't',
      occurredAt: at('2026-10-05'),
      counterparty: 'SPOTIFY INDIA',
      kind: 'expense',
      status: 'confirmed',
      confidence: 0.95,
      reviewReason: null,
      categoryReason: null,
      categoryRuleId: null,
      userSetFields: [],
      note: null,
      postings: [
        { id: 'p1', accountId: 'hdfc', amount: paise(-19900) },
        { id: 'p2', accountId: 'music', amount: paise(19900) },
      ],
      sources: [{ id: 's', kind: 'sms', sender: 'HDFCBK', externalRef: null, fingerprint: 'f', parsedFields: { vpa: 'spotify@hdfcbank' }, receivedAt: at('2026-10-05'), confidence: 0.95, rawText: null }],
    };
    expect(debitOf(tx, (id) => id === 'hdfc')).toMatchObject({ amount: 19900, vpa: 'spotify@hdfcbank', merchant: 'spotify', accountId: 'hdfc', categoryId: 'music' });
    expect(debitOf({ ...tx, kind: 'income' }, (id) => id === 'hdfc')).toBeNull();
  });

  it('says a payment is overdue only after the 3-day window', () => {
    expect(dueState({ nextDue: '2026-10-25' }, '2026-10-23')).toEqual({ days: 2, overdue: false });
    expect(dueState({ nextDue: '2026-10-19' }, '2026-10-23')).toEqual({ days: -4, overdue: true });
  });
});

describe('shortfall (REC-3)', () => {
  const rent = { ...netflix, id: 'rent', accountId: 'hdfc', amount: paise(2000000), nextDue: '2026-11-01' };
  const sip = { ...netflix, id: 'sip', accountId: 'hdfc', amount: paise(500000), nextDue: '2026-11-05' };

  it('counts earlier payments from the same account', () => {
    const account = { balance: paise(2200000), liability: false };
    expect(shortfall(rent, [rent, sip], account)).toBeNull();
    expect(shortfall(sip, [rent, sip], account)).toBe(300000);
  });

  it('never warns about cards or payments with no account', () => {
    expect(shortfall(sip, [rent, sip], { balance: paise(-100), liability: true })).toBeNull();
    expect(shortfall({ ...sip, accountId: null }, [rent, sip], { balance: paise(0), liability: false })).toBeNull();
  });
});
