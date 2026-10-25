import {
  addMonths,
  overspends,
  paise,
  reviewSuggestions,
  type BudgetSuggestion,
  type MonthKey,
  type Overspend,
  type Paise,
  type ReviewLine,
  type SpendItem,
} from '@money-plant/core';
import { formatMonth } from '@/components/format';
import { categoryBreakdown, currentMonth, incomeThisMonth, monthOverview, setBudget, type MonthOverview } from './budgets';
import type { CategoryNode } from './categories';
import { kvGet, kvSet } from './kv';
import { notifyAt } from './notifications';

/** Payees and entries shown under each overspend. */
const CAUSES = 3;
/** Biggest categories shown when no budget went over. */
const BIGGEST = 5;

export interface ReviewOverspend extends Overspend {
  category: CategoryNode;
  payees: { merchant: string; amount: Paise; count: number }[];
  largest: SpendItem[];
}

export interface ReviewSuggestion extends BudgetSuggestion {
  category: CategoryNode;
}

export interface MonthReview {
  month: MonthKey;
  /** All spending: in budgeted categories and outside them. */
  spent: Paise;
  /** The month's total budget, or null with no budgets. */
  budget: Paise | null;
  /** Spent in budgeted categories. */
  inBudgets: Paise;
  outside: Paise;
  income: Paise;
  overspends: ReviewOverspend[];
  /** Top-level categories by spending, for months with nothing over. */
  biggest: { category: CategoryNode; spent: Paise }[];
  uncategorised: { category: CategoryNode; count: number; amount: Paise } | null;
  suggestions: ReviewSuggestion[];
  moved: MonthOverview['moved'];
}

const ignoredKey = (categoryId: string) => `review.ignored.${categoryId}`;

/**
 * BUD-4: the month review, worked out on the phone from the ledger. Every
 * figure comes from the same queries as the Budgets tab, so each one opens
 * the entries behind it.
 */
export async function monthReview(month: MonthKey): Promise<MonthReview> {
  const [overview, income, ...before] = await Promise.all([
    monthOverview(month),
    incomeThisMonth(month),
    ...[3, 2, 1].map((n) => monthOverview(addMonths(month, -n))),
  ]);
  const spentBefore = (id: string) => before.map((o) => o.lines.find((l) => l.category?.id === id)?.spent ?? paise(0));
  const branchHasBudget = (id: string) => overview.lines.some((l) => l.limit !== null && (l.category!.id === id || l.category!.parentId === id));

  const reviewLines: ReviewLine[] = overview.lines
    .filter((l) => !l.category!.system)
    .map((l) => ({
      categoryId: l.category!.id,
      spent: l.spent,
      limit: l.limit,
      previous: spentBefore(l.category!.id),
      canStart: l.category!.parentId === null && !branchHasBudget(l.category!.id),
    }));
  const byId = new Map(overview.lines.map((l) => [l.category!.id, l.category!]));

  const over = await Promise.all(
    overspends(reviewLines).map(async (o) => {
      const detail = await categoryBreakdown(month, o.categoryId);
      return { ...o, category: byId.get(o.categoryId)!, payees: detail.byMerchant.slice(0, CAUSES), largest: detail.largest.slice(0, CAUSES) };
    }),
  );

  const suggestions: ReviewSuggestion[] = [];
  for (const s of reviewSuggestions(reviewLines)) {
    if ((await kvGet(ignoredKey(s.categoryId))) === String(s.suggested)) continue;
    suggestions.push({ ...s, category: byId.get(s.categoryId)! });
  }

  const uncategorisedLine = overview.lines.find((l) => l.category!.system && l.spent > 0);
  let uncategorised: MonthReview['uncategorised'] = null;
  if (uncategorisedLine) {
    const detail = await categoryBreakdown(month, uncategorisedLine.category!.id);
    const count = detail.byMerchant.reduce((sum, m) => sum + m.count, 0);
    uncategorised = { category: uncategorisedLine.category!, count, amount: uncategorisedLine.spent };
  }

  const budget = overview.overall.limit;
  return {
    month,
    spent: paise(overview.overall.spent + overview.outside),
    budget,
    inBudgets: overview.overall.spent,
    outside: overview.outside,
    income,
    overspends: over,
    biggest: overview.lines
      .filter((l) => l.category!.parentId === null && l.spent > 0)
      .sort((a, b) => b.spent - a.spent)
      .slice(0, BIGGEST)
      .map((l) => ({ category: l.category!, spent: l.spent })),
    uncategorised,
    suggestions,
    moved: overview.moved,
  };
}

/** Accepting a suggestion sets that category's budget for every month (BUD-1). */
export async function acceptSuggestion(categoryId: string, limit: Paise): Promise<void> {
  await setBudget(null, categoryId, limit);
}

/** An ignored suggestion stays hidden until the suggested amount changes. */
export async function ignoreSuggestion(suggestion: BudgetSuggestion): Promise<void> {
  await kvSet(ignoredKey(suggestion.categoryId), String(suggestion.suggested));
}

/** The month whose review is the latest one ready: last month. */
export function lastMonth(): MonthKey {
  return addMonths(currentMonth(), -1);
}

export const REVIEW_HOUR = 9;

/**
 * BUD-4: a notification at 9 am on the 1st that this month's review is
 * ready. Scheduled again on every refresh, under one id, so it always
 * points at the month that is ending.
 */
export async function scheduleMonthReview(): Promise<void> {
  const month = currentMonth();
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5)) - 1];
  const name = formatMonth(month).split(' ')[0]!;
  await notifyAt({
    id: 'month-review',
    channel: 'budgets',
    at: new Date(year, index + 1, 1, REVIEW_HOUR, 0, 0),
    title: `Your ${name} review is ready`,
    body: 'See what went over, why, and budget changes for next month.',
    data: { url: `/month-review?month=${month}` },
  });
}
