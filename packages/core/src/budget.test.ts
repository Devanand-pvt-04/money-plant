import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { OVERALL, addMonths, breakdown, budgetPace, budgetSettings, budgetTotal, countedBudgets, effectiveBudgets, rollUp, suggestBudget, suggestionStep, sortBudgets, combineBudgets, withCarries, carryQuestions, absorbDebts, debtClearsBy, type CarryDebt } from './budget';

describe('effectiveBudgets', () => {
  const rows = [
    { month: null, categoryId: 'food', limit: paise(800000) },
    { month: '2026-10', categoryId: 'food', limit: paise(1000000) },
    { month: null, categoryId: null, limit: paise(5000000) },
    { month: '2026-09', categoryId: 'fuel', limit: paise(300000) },
  ];

  it('applies a default to every month (BUD-1)', () => {
    for (const month of ['2026-07', '2026-09', '2026-11']) {
      const limits = effectiveBudgets(rows, month);
      expect(limits.get('food')).toBe(800000);
      expect(limits.get(OVERALL)).toBe(5000000);
    }
  });

  it('lets an override change one month only', () => {
    expect(effectiveBudgets(rows, '2026-10').get('food')).toBe(1000000);
    expect(effectiveBudgets(rows, '2026-09').get('fuel')).toBe(300000);
    expect(effectiveBudgets(rows, '2026-10').has('fuel')).toBe(false);
  });

  it('keeps the default next to the override, for resetting', () => {
    expect(budgetSettings(rows, '2026-10').get('food')).toEqual({ default: 800000, override: 1000000, limit: 1000000 });
    expect(budgetSettings(rows, '2026-09').get('fuel')).toEqual({ default: null, override: 300000, limit: 300000 });
  });
});

describe('addMonths', () => {
  it('crosses year boundaries', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('rollUp', () => {
  it('adds sub-categories into their parent (CAT-5)', () => {
    const totals = new Map([
      ['food', paise(10000)],
      ['lunch', paise(25000)],
      ['delivery', paise(40000)],
      ['rent', paise(2000000)],
    ]);
    const parents = new Map<string, string | null>([
      ['food', null],
      ['lunch', 'food'],
      ['delivery', 'food'],
      ['rent', null],
    ]);
    const result = rollUp(totals, parents);
    expect(result.get('food')).toBe(75000);
    expect(result.get('lunch')).toBe(25000);
    expect(result.get('rent')).toBe(2000000);
  });
});

describe('budgetPace', () => {
  it('flags a category on track to overspend (BUD-2)', () => {
    expect(budgetPace(paise(600000), paise(1000000), 0.4).status).toBe('pace');
  });

  it('stays quiet early in the month and when on track', () => {
    expect(budgetPace(paise(500000), paise(1000000), 0.1).status).toBe('ok');
    expect(budgetPace(paise(400000), paise(1000000), 0.5).status).toBe('ok');
  });

  it('reports over budget', () => {
    const pace = budgetPace(paise(1000100), paise(1000000), 0.9);
    expect(pace.status).toBe('over');
    expect(Number.isInteger(pace.projected)).toBe(true);
  });
});

describe('suggestBudget', () => {
  it('rounds the 3-month average up to ₹500', () => {
    expect(suggestBudget([paise(410000), paise(380000), paise(450000)])).toBe(450000);
  });

  it('rounds to a step that suits the currency (decision 0017)', () => {
    expect(suggestionStep('INR')).toBe(50_000);
    expect(suggestionStep('USD')).toBe(1000);
    expect(suggestionStep('JPY')).toBe(1000);
    expect(suggestionStep('KWD')).toBe(10_000);
    expect(suggestBudget([paise(41_234), paise(38_000)], suggestionStep('USD'))).toBe(40_000);
  });

  it('returns null without spending', () => {
    expect(suggestBudget([paise(0), paise(0)])).toBeNull();
    expect(suggestBudget([])).toBeNull();
  });
});

describe('breakdown', () => {
  it('groups by category and merchant and lists the largest entries (BUD-3)', () => {
    const items = [
      { transactionId: 'a', categoryId: 'delivery', counterparty: 'SWIGGY', occurredAt: '2026-10-03T12:00:00Z', amount: paise(45000) },
      { transactionId: 'b', categoryId: 'delivery', counterparty: 'SWIGGY', occurredAt: '2026-10-04T12:00:00Z', amount: paise(60000) },
      { transactionId: 'c', categoryId: 'lunch', counterparty: 'CANTEEN', occurredAt: '2026-10-05T12:00:00Z', amount: paise(12000) },
      { transactionId: 'd', categoryId: 'delivery', counterparty: 'SWIGGY', occurredAt: '2026-10-06T12:00:00Z', amount: paise(-5000) },
    ];
    const result = breakdown(items, { top: 2 });
    expect(result.total).toBe(112000);
    expect(result.byCategory[0]).toEqual({ categoryId: 'delivery', amount: 100000 });
    expect(result.byMerchant[0]).toEqual({ merchant: 'SWIGGY', amount: 100000, count: 3 });
    expect(result.largest.map((item) => item.transactionId)).toEqual(['b', 'a']);
  });
});

describe('countedBudgets and budgetTotal', () => {
  const parentOf = new Map<string, string | null>([
    ['food', null],
    ['lunch', 'food'],
    ['dinner', 'food'],
    ['transport', null],
    ['fuel', 'transport'],
    ['bills', null],
  ]);
  const p = (n: number) => paise(n);

  it('drops the overall budget and a child under a budgeted parent', () => {
    const limits = new Map([
      [OVERALL, p(50000)],
      ['food', p(10000)],
      ['lunch', p(3000)],
      ['fuel', p(4000)],
    ]);
    expect([...countedBudgets(limits, parentOf)]).toEqual([
      ['food', 10000],
      ['fuel', 4000],
    ]);
  });

  it('sums the budgets, counts only budgeted spending and reports the rest as outside', () => {
    const counted = new Map([
      ['food', p(10000)],
      ['fuel', p(4000)],
    ]);
    // Rolled up: food includes lunch and dinner; transport includes fuel and other transport.
    const spent = new Map([
      ['food', p(7000)],
      ['lunch', p(2000)],
      ['transport', p(6000)],
      ['fuel', p(3500)],
      ['bills', p(9000)],
    ]);
    expect(budgetTotal(counted, spent, p(22000))).toEqual({ limit: 14000, spent: 10500, outside: 11500 });
  });

  it('falls back to all spending when no budget is set', () => {
    expect(budgetTotal(new Map(), new Map(), p(22000))).toEqual({ limit: null, spent: 22000, outside: 0 });
  });
});

describe('sortBudgets', () => {
  const b = (name: string, spent: number, limit: number | null, status: 'ok' | 'pace' | 'over' | null = limit === null ? null : 'ok') => ({
    name,
    spent: paise(spent),
    limit: limit === null ? null : paise(limit),
    status,
  });
  const lines = [b('Food', 4_000, 10_000), b('Rent', 12_500, 12_500), b('Car', 6_000, 5_000, 'over'), b('Gifts', 2_000, null), b('Travel', 3_000, 4_000, 'pace'), b('Pets', 0, null)];
  const names = (sort: Parameters<typeof sortBudgets>[1]) => sortBudgets(lines, sort, (l) => l).map((l) => l.name);
  it('puts over budget first, then ahead of pace, then the most used', () => {
    expect(names('attention')).toEqual(['Car', 'Travel', 'Rent', 'Food', 'Gifts', 'Pets']);
  });
  it('sorts by share used, budget, spent and name', () => {
    expect(names('used')).toEqual(['Car', 'Rent', 'Travel', 'Food', 'Gifts', 'Pets']);
    expect(names('budget')).toEqual(['Rent', 'Food', 'Car', 'Travel', 'Gifts', 'Pets']);
    expect(names('spent')).toEqual(['Rent', 'Car', 'Food', 'Travel', 'Gifts', 'Pets']);
    expect(names('name')).toEqual(['Car', 'Food', 'Gifts', 'Pets', 'Rent', 'Travel']);
  });
  it('combines sub-category budgets with their worst status', () => {
    expect(combineBudgets('Car', paise(7_000), [b('Fuel', 5_000, 4_000, 'over'), b('Service', 2_000, 3_000), b('Parking', 0, null)])).toEqual({
      name: 'Car',
      spent: 7_000,
      limit: 7_000,
      status: 'over',
    });
  });
});

describe('withCarries (BUD-5)', () => {
  const counted = new Map([
    ['food', paise(500000)],
    ['fuel', paise(300000)],
    ['rent', paise(2000000)],
  ]);

  it('adds a leftover and takes off an overspend', () => {
    const result = withCarries(counted, new Map([['food', paise(80000)], ['fuel', paise(-120000)]]));
    expect(result.get('food')).toBe(580000);
    expect(result.get('fuel')).toBe(180000);
    expect(result.get('rent')).toBe(2000000);
  });

  it('never goes below zero', () => {
    expect(withCarries(counted, new Map([['fuel', paise(-450000)]])).get('fuel')).toBe(0);
  });

  it('ignores a carry on a category without a counted budget', () => {
    expect(withCarries(counted, new Map([['travel', paise(10000)]])).has('travel')).toBe(false);
  });
});

describe('carryQuestions (BUD-5)', () => {
  const limits = new Map([
    ['food', paise(580000)],
    ['fuel', paise(300000)],
    ['rent', paise(2000000)],
    ['gifts', paise(100000)],
  ]);
  const spent = new Map([
    ['food', paise(450000)],
    ['fuel', paise(420000)],
    ['rent', paise(2000000)],
  ]);

  it('offers leftovers and overspends for budgets in both months', () => {
    expect(carryQuestions(limits, spent, new Set(['food', 'fuel', 'rent']))).toEqual([
      { categoryId: 'food', amount: 130000 },
      { categoryId: 'fuel', amount: -120000 },
    ]);
  });

  it('skips a category with no budget next month', () => {
    expect(carryQuestions(limits, spent, new Set(['fuel'])).map((q) => q.categoryId)).toEqual(['fuel']);
  });

  it('offers a whole unspent budget', () => {
    expect(carryQuestions(limits, spent, new Set(['gifts']))).toEqual([{ categoryId: 'gifts', amount: 100000 }]);
  });
});

describe('absorbDebts (BUD-5)', () => {
  const debt = (over: Partial<CarryDebt> = {}): CarryDebt => ({ id: 'd1', into: '2026-11', amount: paise(700000), spread: null, stoppedFrom: null, ...over });
  const flat = (amount: number) => () => amount;

  it('takes an overspend as needed across months until cleared', () => {
    const months = absorbDebts([debt()], flat(300000), '2027-02');
    expect(months.get('2026-11')!.taken.get('d1')).toBe(300000);
    expect(months.get('2026-12')!.taken.get('d1')).toBe(300000);
    expect(months.get('2027-01')!.taken.get('d1')).toBe(100000);
    expect(months.get('2027-01')!.left.get('d1')).toBe(0);
    expect(months.get('2027-02')!.taken.has('d1')).toBe(false);
    expect(debtClearsBy('d1', months)).toBe('2027-01');
  });

  it('spreads equal parts, rounding the first up', () => {
    const months = absorbDebts([debt({ spread: 3 })], flat(1000000), '2027-01');
    expect([...months.values()].map((m) => m.taken.get('d1'))).toEqual([233334, 233333, 233333]);
  });

  it('moves a part a month cannot take on to the next', () => {
    const room = (m: string) => (m === '2026-11' ? 100000 : 1000000);
    const months = absorbDebts([debt({ spread: 2 })], room, '2027-01');
    expect(months.get('2026-11')!.taken.get('d1')).toBe(100000);
    expect(months.get('2026-12')!.taken.get('d1')).toBe(600000);
  });

  it('waits through months with no budget', () => {
    const room = (m: string) => (m === '2026-12' ? null : 300000);
    const months = absorbDebts([debt()], room, '2027-02');
    expect(months.get('2026-12')!.taken.size).toBe(0);
    expect(months.get('2027-01')!.taken.get('d1')).toBe(300000);
    expect(months.get('2027-02')!.taken.get('d1')).toBe(100000);
  });

  it('drops what is left once stopped', () => {
    const months = absorbDebts([debt({ stoppedFrom: '2026-12' })], flat(300000), '2027-01');
    expect(months.get('2026-11')!.taken.get('d1')).toBe(300000);
    expect(months.get('2026-12')!.taken.size).toBe(0);
    expect(months.get('2026-12')!.left.get('d1')).toBe(0);
  });

  it('takes the oldest overspend first, and a later one queues behind it', () => {
    const months = absorbDebts([debt({ id: 'b', into: '2026-12', amount: paise(200000) }), debt({ id: 'a', amount: paise(400000) })], flat(300000), '2027-01');
    expect(months.get('2026-12')!.taken.get('a')).toBe(100000);
    expect(months.get('2026-12')!.taken.get('b')).toBe(200000);
  });

  it('never clears with no budget ahead', () => {
    expect(debtClearsBy('d1', absorbDebts([debt()], () => null, '2027-12'))).toBeNull();
  });
});
