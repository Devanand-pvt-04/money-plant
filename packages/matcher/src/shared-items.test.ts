import { describe, expect, it } from 'vitest';
import { paise } from '@money-plant/core';
import {
  counterpartCandidates,
  itemStatus,
  splitBill,
  splitEqually,
  ledgerGap,
  linkPostings,
  sharedBalance,
  shareEntryPostings,
  unlinkPostings,
  viewerFlow,
  type CandidateEntry,
  type SharedItem,
} from './shared-items';

const item = (over: Partial<SharedItem> = {}): SharedItem => ({
  id: 'i1',
  kind: 'share',
  flow: 'to_them',
  amount: paise(60000),
  currency: 'INR',
  occurredOn: '2026-11-13',
  answer: null,
  mine: true,
  oneSided: false,
  ...over,
});

let n = 0;
const newId = () => `new-${n++}`;
const sum = (ps: { amount: number }[]) => ps.reduce((s, p) => s + p.amount, 0);

describe('viewerFlow and sharedBalance (decision 0026)', () => {
  it('flips the flow for the other side', () => {
    expect(viewerFlow('to_them', true)).toBe('to_them');
    expect(viewerFlow('to_them', false)).toBe('to_me');
  });

  it('adds what they owe and takes off what the viewer owes, per currency', () => {
    const balance = sharedBalance([
      item({ kind: 'share', flow: 'to_them', amount: paise(60000) }),
      item({ kind: 'loan', flow: 'to_them', amount: paise(50000) }),
      item({ kind: 'repayment', flow: 'to_me', amount: paise(30000) }),
      item({ kind: 'loan', flow: 'to_me', amount: paise(1000), currency: 'USD' }),
    ]);
    expect(Object.fromEntries(balance)).toEqual({ INR: 80000, USD: -1000 });
  });

  it('both sides see the same balance, sign flipped', () => {
    const rows = [
      { kind: 'share' as const, flow: 'to_them' as const, amount: paise(60000), answer: 'accepted' as const },
      { kind: 'repayment' as const, flow: 'to_me' as const, amount: paise(20000), answer: null },
    ];
    const mine = sharedBalance(rows.map((r) => item({ ...r, mine: true })));
    const theirs = sharedBalance(rows.map((r) => item({ ...r, flow: viewerFlow(r.flow, false), mine: false })));
    expect(mine.get('INR')).toBe(40000);
    expect(theirs.get('INR')).toBe(-40000);
  });

  it('a declined share never counts; one waiting counts only for its creator', () => {
    expect(sharedBalance([item({ answer: 'declined' })]).size).toBe(0);
    expect(sharedBalance([item({ mine: false, flow: 'to_me' })]).size).toBe(0);
    expect(sharedBalance([item({ mine: true })]).get('INR')).toBe(60000);
  });
});

describe('shareEntryPostings', () => {
  it('a share the other person paid is spending owed to them, with no bank leg', () => {
    const ps = shareEntryPostings(item({ flow: 'to_me' }), 'food', 'asha', newId);
    expect(ps.map((p) => [p.accountId, p.amount])).toEqual([
      ['food', 60000],
      ['asha', -60000],
    ]);
    expect(sum(ps)).toBe(0);
  });

  it('refuses a share the viewer paid: that one links their own bank entry', () => {
    expect(() => shareEntryPostings(item({ flow: 'to_them' }), 'food', 'asha', newId)).toThrow();
  });
});

describe('linkPostings', () => {
  const own = new Set(['bank']);
  const payment = [
    { id: 'p1', accountId: 'bank', amount: paise(-100000) },
    { id: 'p2', accountId: 'food', amount: paise(100000) },
  ];

  it('splits a bank payment: the share moves from the category to the person', () => {
    const ps = linkPostings(payment, own, item({ flow: 'to_them', amount: paise(60000) }), 'bala', newId);
    expect(ps.map((p) => [p.accountId, p.amount])).toEqual([
      ['bank', -100000],
      ['food', 40000],
      ['bala', 60000],
    ]);
    expect(sum(ps)).toBe(0);
  });

  it('a whole loan takes the category leg away entirely', () => {
    const ps = linkPostings(payment, own, item({ kind: 'loan', flow: 'to_them', amount: paise(100000) }), 'bala', newId);
    expect(ps.map((p) => [p.accountId, p.amount])).toEqual([
      ['bank', -100000],
      ['bala', 100000],
    ]);
  });

  it('a repayment received lowers what they owe', () => {
    const credit = [
      { id: 'c1', accountId: 'bank', amount: paise(60000) },
      { id: 'c2', accountId: 'uncat-income', amount: paise(-60000) },
    ];
    const ps = linkPostings(credit, own, item({ kind: 'repayment', flow: 'to_me', amount: paise(60000) }), 'bala', newId);
    expect(ps.map((p) => [p.accountId, p.amount])).toEqual([
      ['bank', 60000],
      ['bala', -60000],
    ]);
  });

  it('never changes the bank leg', () => {
    const ps = linkPostings(payment, own, item({ flow: 'to_them', amount: paise(25000) }), 'bala', newId);
    expect(ps.find((p) => p.accountId === 'bank')?.amount).toBe(-100000);
  });

  it('refuses money going the wrong way, or an entry too small', () => {
    expect(() => linkPostings(payment, own, item({ kind: 'loan', flow: 'to_me' }), 'bala', newId)).toThrow('other way');
    expect(() => linkPostings(payment, own, item({ amount: paise(200000) }), 'bala', newId)).toThrow('smaller');
  });

  it('two shares on one bill add up on the person leg', () => {
    const once = linkPostings(payment, own, item({ amount: paise(30000) }), 'bala', newId);
    const twice = linkPostings(once, own, item({ id: 'i2', amount: paise(20000) }), 'bala', newId);
    expect(twice.find((p) => p.accountId === 'bala')?.amount).toBe(50000);
    expect(twice.find((p) => p.accountId === 'food')?.amount).toBe(50000);
  });

  it('unlinking gives the part back to the category', () => {
    const linked = linkPostings(payment, own, item({ amount: paise(60000) }), 'bala', newId);
    const back = unlinkPostings(linked, item({ amount: paise(60000) }), 'bala', 'food', newId);
    expect(back.map((p) => [p.accountId, p.amount])).toEqual([
      ['bank', -100000],
      ['food', 100000],
    ]);
  });
});

describe('counterpartCandidates', () => {
  const entry = (id: string, day: string, own: number, extra: Partial<CandidateEntry> = {}): CandidateEntry => ({
    id,
    day,
    ownAmount: paise(own),
    currency: 'INR',
    taken: false,
    payeeIsPerson: false,
    ...extra,
  });

  it('finds the incoming entry for a loan received, payee first, then the closest day', () => {
    const loan = item({ kind: 'loan', flow: 'to_me', amount: paise(50000), occurredOn: '2026-11-13' });
    const found = counterpartCandidates(
      [
        entry('far', '2026-11-20', 50000),
        entry('out', '2026-11-13', -50000),
        entry('other-amount', '2026-11-13', 40000),
        entry('near', '2026-11-14', 50000),
        entry('payee', '2026-11-15', 50000, { payeeIsPerson: true }),
        entry('taken', '2026-11-13', 50000, { taken: true }),
      ],
      loan,
    );
    expect(found.map((e) => e.id)).toEqual(['payee', 'near']);
  });

  it('a share the viewer paid can link a bigger bank payment; one paid by the other needs none', () => {
    expect(counterpartCandidates([entry('bill', '2026-11-13', -100000)], item({ flow: 'to_them' })).map((e) => e.id)).toEqual(['bill']);
    expect(counterpartCandidates([entry('bill', '2026-11-13', 60000)], item({ flow: 'to_me' }))).toEqual([]);
  });
});

describe('itemStatus and ledgerGap', () => {
  it('says what each side has to do', () => {
    expect(itemStatus(item({ mine: false, answer: null }), false)).toBe('needs_answer');
    expect(itemStatus(item({ mine: true, answer: null }), true)).toBe('waiting');
    expect(itemStatus(item({ mine: true, answer: 'accepted' }), true)).toBe('linked');
    expect(itemStatus(item({ kind: 'loan', mine: false }), false)).toBe('needs_link');
    expect(itemStatus(item({ answer: 'declined' }), true)).toBe('declined');
    expect(itemStatus(item({ mine: true, oneSided: true }), true)).toBe('linked');
  });

  it('shows what the ledger is missing against the shared balance', () => {
    const gap = ledgerGap(new Map([['INR', paise(80000)]]), new Map([['INR', paise(60000)]]));
    expect(Object.fromEntries(gap)).toEqual({ INR: 20000 });
    expect(ledgerGap(new Map([['INR', paise(1)]]), new Map([['INR', paise(1)]])).size).toBe(0);
  });
});

describe('splitEqually (step 4)', () => {
  it('gives each person an equal share and keeps the odd paise on the user', () => {
    expect(splitEqually(paise(100_000), 2, true)).toEqual([33_333, 33_333]);
  });

  it('adds up to the whole bill when the user is not part of it', () => {
    const shares = splitEqually(paise(100_000), 3, false);
    expect(shares).toEqual([33_334, 33_333, 33_333]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(100_000);
  });

  it('splits nothing for no one', () => {
    expect(splitEqually(paise(100_000), 0, true)).toEqual([]);
  });
});

describe('splitBill (decision 0027)', () => {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  const on = (value: number | null = null) => ({ in: true, value });
  const off = { in: false, value: null };

  it('splits equally and keeps the odd paise on the user', () => {
    const r = splitBill(41_200, 'equally', [on(), on(), on(), on(), on()], 0);
    expect(r.problem).toBeNull();
    expect(r.parts).toEqual([8_240, 8_240, 8_240, 8_240, 8_240]);
    const odd = splitBill(100_000, 'equally', [on(), on(), on()], 0);
    expect(odd.parts).toEqual([33_334, 33_333, 33_333]);
  });

  it('leaves out someone who is not in, and spreads paise over the others when the user is out', () => {
    const r = splitBill(100_000, 'equally', [off, on(), on(), on()], 0);
    expect(r.parts).toEqual([0, 33_334, 33_333, 33_333]);
    expect(sum(r.parts)).toBe(100_000);
  });

  it('splits by shares: 2 for a couple, 1 each for the rest', () => {
    const r = splitBill(240_000, 'shares', [on(1), on(2), on(1), on(2)], 0);
    expect(r.parts).toEqual([40_000, 80_000, 40_000, 80_000]);
    expect(splitBill(100_000, 'shares', [on(1), on(1), on(1)], 0).parts).toEqual([33_334, 33_333, 33_333]);
  });

  it('a row with no shares is out', () => {
    const r = splitBill(90_000, 'shares', [on(1), on(0), on(2)], 0);
    expect(r.parts).toEqual([30_000, 0, 60_000]);
  });

  it('splits by percent and says how far from 100% it is', () => {
    const r = splitBill(100_000, 'percent', [on(5_000), on(2_500), on(2_500)], 0);
    expect(r.problem).toBeNull();
    expect(r.parts).toEqual([50_000, 25_000, 25_000]);
    const short = splitBill(100_000, 'percent', [on(5_000), on(2_500)], 0);
    expect(short.problem).toBe('percent');
    expect(short.left).toBe(2_500);
    expect(splitBill(100_000, 'percent', [on(6_000), on(6_000)], 0).left).toBe(-2_000);
  });

  it('by amounts: the user takes what the others leave', () => {
    const r = splitBill(100_000, 'amounts', [on(), on(30_000), on(25_000)], 0);
    expect(r.problem).toBeNull();
    expect(r.parts).toEqual([45_000, 30_000, 25_000]);
    expect(splitBill(100_000, 'amounts', [on(), on(80_000), on(30_000)], 0).problem).toBe('over');
  });

  it('by amounts without the user: the others must add up to the bill', () => {
    const short = splitBill(100_000, 'amounts', [off, on(30_000), on(25_000)], 0);
    expect(short.problem).toBe('short');
    expect(short.left).toBe(45_000);
    expect(splitBill(100_000, 'amounts', [off, on(50_000), on(50_000)], 0).problem).toBeNull();
  });

  it('adjusts an equal split for someone who had extra', () => {
    const r = splitBill(100_000, 'adjust', [on(0), on(15_000), on(0)], 0);
    expect(r.problem).toBeNull();
    expect(r.parts).toEqual([28_334, 43_333, 28_333]);
    expect(sum(r.parts)).toBe(100_000);
    expect(splitBill(100_000, 'adjust', [on(0), on(-20_000), on(0)], 0).parts).toEqual([40_000, 20_000, 40_000]);
  });

  it('flags adjustments bigger than the bill or a part below zero', () => {
    expect(splitBill(10_000, 'adjust', [on(0), on(20_000)], 0).problem).toBe('over');
    expect(splitBill(10_000, 'adjust', [on(0), on(-12_000)], 0).problem).toBe('negative');
  });

  it('needs a total and someone in', () => {
    expect(splitBill(0, 'equally', [on()], 0).problem).toBe('no_total');
    expect(splitBill(10_000, 'equally', [off, off], 0).problem).toBe('none_in');
  });
});
