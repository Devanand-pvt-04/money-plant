import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { OVERALL, addMonths, breakdown, budgetPace, effectiveBudgets, rollUp, suggestBudget } from './budget';

describe('effectiveBudgets', () => {
  const rows = [
    { month: '2026-08', categoryId: 'food', limit: paise(800000) },
    { month: '2026-10', categoryId: 'food', limit: paise(1000000) },
    { month: '2026-09', categoryId: null, limit: paise(5000000) },
    { month: '2026-09', categoryId: 'fuel', limit: paise(300000) },
    { month: '2026-10', categoryId: 'fuel', limit: null },
  ];

  it('carries a budget forward until a later month changes it (BUD-1)', () => {
    const sept = effectiveBudgets(rows, '2026-09');
    expect(sept.get('food')).toBe(800000);
    expect(sept.get(OVERALL)).toBe(5000000);
    expect(sept.get('fuel')).toBe(300000);
    const nov = effectiveBudgets(rows, '2026-11');
    expect(nov.get('food')).toBe(1000000);
    expect(nov.get(OVERALL)).toBe(5000000);
  });

  it('treats a null limit as removing the budget from that month', () => {
    expect(effectiveBudgets(rows, '2026-10').has('fuel')).toBe(false);
  });

  it('ignores rows from later months', () => {
    expect(effectiveBudgets(rows, '2026-07').size).toBe(0);
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
