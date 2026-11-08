import { describe, expect, it } from 'vitest';
import { paise, type Paise } from '@money-plant/core';
import { checkSplitShares, groupBalances, groupExpense, readSplit, splittableAmount } from './split-views';
import type { LedgerSource, LedgerTransaction } from './types';

const BANK = 'bank';
const FOOD = 'food';
const BALA = 'p-bala';
const CHITRA = 'p-chitra';
const accounts = { owned: new Set([BANK]), people: new Set([BALA, CHITRA]) };
const names = new Map([
  [BALA, 'Bala'],
  [CHITRA, 'Chitra'],
]);

function tx(postings: [string, number][], overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return {
    id: 'tx',
    occurredAt: '2026-11-05T13:00:00Z',
    counterparty: 'Truffles',
    kind: 'expense',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: 'user',
    categoryRuleId: null,
    userSetFields: [],
    note: null,
    postings: postings.map(([accountId, amount], i) => ({ id: `p${i}`, accountId, amount: paise(amount) })),
    sources: [],
    ...overrides,
  };
}

const manual = (fields: Record<string, unknown>): LedgerSource => ({
  id: 's',
  kind: 'manual',
  sender: null,
  externalRef: null,
  fingerprint: 'f',
  parsedFields: fields,
  receivedAt: '2026-11-05T13:00:00Z',
  confidence: 1,
  rawText: null,
});

// Paid 1,200 at a restaurant: 400 mine, 500 Bala's, 300 Chitra's.
const split = tx([
  [BANK, -120_000],
  [FOOD, 40_000],
  [BALA, 50_000],
  [CHITRA, 30_000],
]);

describe('readSplit', () => {
  it('reads each share back from the postings', () => {
    expect(readSplit(split, accounts)).toEqual({
      total: 120_000,
      categoryId: FOOD,
      myShare: 40_000,
      shares: new Map([
        [BALA, 50_000],
        [CHITRA, 30_000],
      ]),
    });
  });

  it('is null for a plain payment or a loan', () => {
    expect(readSplit(tx([[BANK, -5_000], [FOOD, 5_000]]), accounts)).toBeNull();
    expect(readSplit(tx([[BANK, -5_000], [BALA, 5_000]], { kind: 'iou' }), accounts)).toBeNull();
  });

  it('reads a share of nothing for the user when they paid only for others', () => {
    expect(readSplit(tx([[BANK, -5_000], [BALA, 5_000]]), accounts)).toMatchObject({ categoryId: null, myShare: 0 });
  });
});

describe('splittableAmount', () => {
  it('is the money out of the one account that paid', () => {
    expect(splittableAmount(tx([[BANK, -5_000], [FOOD, 5_000]]), accounts)).toEqual({ total: 5_000, categoryId: FOOD });
    expect(splittableAmount(split, accounts)).toEqual({ total: 120_000, categoryId: FOOD });
  });

  it('refuses money in, transfers between own accounts, and loans', () => {
    expect(splittableAmount(tx([[BANK, 5_000], [FOOD, -5_000]]), accounts)).toBeNull();
    const twoOwn = { owned: new Set([BANK, 'card']), people: accounts.people };
    expect(splittableAmount(tx([[BANK, -5_000], ['card', 5_000]]), twoOwn)).toBeNull();
    expect(splittableAmount(tx([[BANK, -5_000], [BALA, 5_000]], { kind: 'iou' }), accounts)).toBeNull();
  });
});

describe('checkSplitShares', () => {
  const shares = (entries: [string, number][]) => new Map(entries.map(([k, v]) => [k, paise(v)] as [string, Paise]));

  it('accepts shares that make the total', () => {
    expect(checkSplitShares(paise(120_000), paise(40_000), shares([[BALA, 50_000], [CHITRA, 30_000]]))).toBeNull();
    expect(checkSplitShares(paise(10_000), paise(0), shares([[BALA, 10_000]]))).toBeNull();
  });

  it('says by how much the shares miss', () => {
    expect(checkSplitShares(paise(120_000), paise(40_000), shares([[BALA, 50_000]]))).toEqual({ code: 'wrong_sum', sum: 90_000, total: 120_000 });
  });

  it('needs someone other than the user', () => {
    expect(checkSplitShares(paise(10_000), paise(10_000), shares([]))).toEqual({ code: 'no_one' });
    expect(checkSplitShares(paise(10_000), paise(10_000), shares([[BALA, 0]]))).toEqual({ code: 'no_one' });
  });
});

describe('groupExpense', () => {
  it('shows a bill the user paid, split three ways', () => {
    expect(groupExpense({ ...split, id: 'a' }, accounts.owned, names)).toEqual({
      id: 'a',
      occurredAt: '2026-11-05T13:00:00Z',
      title: 'Truffles',
      payerName: null,
      total: 120_000,
      ways: 3,
      net: 80_000,
    });
  });

  it('shows a bill someone else paid, with the total they entered', () => {
    const paidByBala = tx([[BALA, -40_000], [FOOD, 40_000]], { sources: [manual({ total: 120_000 })], counterparty: null, note: 'Groceries' });
    expect(groupExpense(paidByBala, accounts.owned, names)).toMatchObject({ title: 'Groceries', payerName: 'Bala', total: 120_000, ways: 1, net: -40_000 });
  });

  it("falls back to the payer's posting when no total was entered", () => {
    const paidByBala = tx([[BALA, -40_000], [FOOD, 40_000]], { counterparty: null });
    expect(groupExpense(paidByBala, accounts.owned, names)).toMatchObject({ title: 'Expense', total: 40_000 });
  });
});

describe('groupBalances', () => {
  const iou = (personId: string | null, transactionId: string, outstanding: number, more: Partial<{ state: 'confirmed' | 'declined'; direction: 'lent' | 'borrowed' }> = {}) => ({
    personId,
    transactionId,
    state: more.state ?? ('confirmed' as const),
    direction: more.direction ?? ('lent' as const),
    outstanding: paise(outstanding),
  });

  it("nets what's open on the group's expenses, by person", () => {
    const balances = groupBalances(
      [
        iou(BALA, 'a', 50_000),
        iou(BALA, 'b', 20_000, { direction: 'borrowed' }),
        iou(CHITRA, 'a', 30_000, { state: 'declined' }),
        iou(CHITRA, 'outside', 99_000),
        iou(null, 'a', 1_000),
      ],
      new Set(['a', 'b']),
    );
    expect(balances).toEqual(new Map([[BALA, 30_000]]));
  });
});
