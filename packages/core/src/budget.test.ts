import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { OVERALL, addMonths, breakdown, budgetPace, budgetSettings, budgetTotal, countedBudgets, effectiveBudgets, rollUp, suggestBudget } from './budget';

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
