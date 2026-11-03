import { describe, expect, it } from 'vitest';
import { buildDataset, type EvalAccount, type EvalTransaction } from './dataset';
import { score, summaryTable } from './score';

const account = (id: string, type: string, name: string, category_key: string | null = null, parent_id: string | null = null): EvalAccount => ({
  id,
  type,
  name,
  category_key,
  parent_id,
  deleted_at: null,
});

const accounts = [
  account('bank', 'bank', 'ICICI'),
  account('food', 'category', 'Food', 'food'),
  account('lunch', 'category', 'Lunch', 'food.custom', 'food'),
  account('health', 'category', 'Health', 'health'),
  account('uncat', 'category', 'Uncategorised'),
];

const spend = (counterparty: string, category: string, amount = 25_000, vpa: string | null = null, at = '2026-10-10T07:00:00Z'): EvalTransaction => ({
  occurred_at: at,
  counterparty,
  kind: 'expense',
  postings: [
    { account_id: 'bank', amount_paise: -amount },
    { account_id: category, amount_paise: amount },
  ],
  sources: [{ kind: 'sms', parsed_fields: { channel: 'upi', vpa } }],
});

describe('buildDataset', () => {
  const dataset = buildDataset(accounts, [
    spend('SHREE GANESH TRADERS', 'lunch'),
    spend('SHREE GANESH TRADERS', 'lunch'),
    spend('SHREE GANESH TRADERS', 'health'),
    spend('SWIGGY', 'food', 40_000, 'swiggy@icici'),
    spend('Ravi Kumar', 'food'),
    spend('MYSTERY 1234', 'food'),
    spend('PHONE 9876543210', 'food'),
    spend('NO CATEGORY', 'uncat'),
  ]);

  it('sends only standard keys as categories', () => {
    expect(dataset.categories).toEqual([
      { key: 'food', name: 'Food' },
      { key: 'health', name: 'Health' },
    ]);
  });

  it('keeps one row per business merchant with the category chosen most', () => {
    expect(dataset.merchants.map((m) => [m.item.merchant, m.expected, m.entries])).toEqual([
      ['shree ganesh traders', 'food', 3],
      ['mystery 1234', 'food', 1],
      ['swiggy', 'food', 1],
    ]);
  });

  it('carries only the fields a real job carries, in IST', () => {
    const swiggy = dataset.merchants.find((m) => m.item.merchant === 'swiggy')!;
    expect(swiggy.item).toEqual({
      merchant: 'swiggy',
      label: 'SWIGGY',
      vpa: 'swiggy@icici',
      amountBand: '₹100 to ₹500',
      timeOfDay: 'afternoon',
      direction: 'debit',
    });
    expect(swiggy.inDictionary).toBe(true);
    expect(dataset.merchants.find((m) => m.item.merchant === 'mystery 1234')!.item.label).toBe('MYSTERY');
  });
});

describe('score', () => {
  const set = [
    { item: { merchant: 'a' }, expected: 'food.lunch', entries: 3, inDictionary: false },
    { item: { merchant: 'b' }, expected: 'health', entries: 1, inDictionary: false },
    { item: { merchant: 'c' }, expected: 'food', entries: 1, inDictionary: false },
    { item: { merchant: 'd' }, expected: 'travel', entries: 5, inDictionary: false },
  ] as never;

  it('counts parent matches, applied answers and confident mistakes', () => {
    const { score: s, misses } = score(
      'm',
      set,
      [
        { merchant: 'a', key: 'food', name: 'A', confidence: 0.9 },
        { merchant: 'b', key: 'health', name: 'B', confidence: 0.5 },
        { merchant: 'c', key: 'shopping', name: 'C', confidence: 0.95 },
      ],
      8,
    );
    expect(s).toEqual({ model: 'm', merchants: 4, exact: 0.25, parent: 0.5, applied: 0.5, appliedWrong: 0.5, entriesRight: 0.3, secondsPerMerchant: 2 });
    expect(misses.map((m) => [m.merchant, m.answer])).toEqual([
      ['c', 'shopping'],
      ['d', 'unknown'],
    ]);
    expect(summaryTable('t', [s])).toContain('| m | 4 | 50% | 25% | 50% | 50% | 30% | 2.0 s |');
  });
});
