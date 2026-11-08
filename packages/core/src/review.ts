import { paise, type Paise } from './money';
import { suggestBudget } from './budget';

/** One budgetable category in a month review (BUD-4). */
export interface ReviewLine {
  categoryId: string;
  /** Spent in the reviewed month, sub-categories included. */
  spent: Paise;
  /** The budget that counted in the reviewed month, or null. */
  limit: Paise | null;
  /** Spent in the 3 months before, oldest first. */
  previous: readonly Paise[];
  /**
   * Whether a new budget can be offered: a top-level category with no budget
   * on it or its sub-categories, so accepting never overlaps another budget.
   */
  canStart: boolean;
}

export interface Overspend {
  categoryId: string;
  spent: Paise;
  limit: Paise;
  over: Paise;
  /** Average of the 3 months before, for "usually". */
  average: Paise;
}

/** BUD-4: the budgets that went over in the reviewed month, largest overspend first. */
export function overspends(lines: readonly ReviewLine[]): Overspend[] {
  return lines
    .filter((line): line is ReviewLine & { limit: Paise } => line.limit !== null && line.spent > line.limit)
    .map((line) => ({
      categoryId: line.categoryId,
      spent: line.spent,
      limit: line.limit,
      over: paise(line.spent - line.limit),
      average: average(line.previous),
    }))
    .sort((a, b) => b.over - a.over);
}

export type SuggestionKind = 'raise' | 'lower' | 'start';

export interface BudgetSuggestion {
  categoryId: string;
  kind: SuggestionKind;
  current: Paise | null;
  suggested: Paise;
}

/** A category needs to average this much before the review offers it a budget. */
export const START_MIN = 200_000; // ₹2,000
/** Spending under this share of the budget in every month suggests lowering it. */
export const LOWER_BELOW = 0.75;
/** At most this many new budgets are offered at once. */
export const MAX_STARTS = 3;

/**
 * BUD-4: budget changes to offer, from the reviewed month and the 2 before
 * it. The suggested amount is their average rounded up to ₹500.
 * - raise: over the budget in at least 2 of the 3 months;
 * - lower: under 3/4 of the budget in all 3 months;
 * - start: no budget yet, averaging ₹2,000 or more (the largest 3).
 * Earlier months are compared with today's budget, since that's the one
 * being changed.
 */
export function reviewSuggestions(
  lines: readonly ReviewLine[],
  /** For a home currency other than the rupee (decision 0017): its rounding step and its start minimum. */
  options: { step?: number; startMin?: number } = {},
): BudgetSuggestion[] {
  const startMin = options.startMin ?? START_MIN;
  const raises: BudgetSuggestion[] = [];
  const lowers: BudgetSuggestion[] = [];
  const starts: BudgetSuggestion[] = [];
  for (const line of lines) {
    const months = [...line.previous.slice(-2), line.spent];
    const suggested = suggestBudget(months, options.step);
    if (suggested === null) continue;
    if (line.limit === null) {
      if (line.canStart && suggested >= startMin) starts.push({ categoryId: line.categoryId, kind: 'start', current: null, suggested });
      continue;
    }
    const limit = line.limit;
    const overCount = months.filter((spent) => spent > limit).length;
    if (overCount >= 2 && suggested > limit) raises.push({ categoryId: line.categoryId, kind: 'raise', current: limit, suggested });
    else if (months.every((spent) => spent < limit * LOWER_BELOW) && suggested < limit) {
      lowers.push({ categoryId: line.categoryId, kind: 'lower', current: limit, suggested });
    }
  }
  const gap = (s: BudgetSuggestion) => Math.abs(s.suggested - (s.current ?? 0));
  return [
    ...raises.sort((a, b) => gap(b) - gap(a)),
    ...lowers.sort((a, b) => gap(b) - gap(a)),
    ...starts.sort((a, b) => b.suggested - a.suggested).slice(0, MAX_STARTS),
  ];
}

function average(values: readonly Paise[]): Paise {
  if (values.length === 0) return paise(0);
  return paise(Math.round(values.reduce((sum, v) => sum + v, 0) / values.length));
}

/**
 * Decision 0012: the facts the phone sends for an AI month review, taken from
 * the review it already shows, so the write-up and the numbers can't disagree.
 * Amounts are whole rupees for the model to read; they are display figures,
 * never written back to the ledger. Payee names carry no long digit runs.
 */
export interface MonthReviewFacts {
  /** "October 2026". */
  month: string;
  spent: number;
  /** The month's total budget, or null with no budgets. */
  budget: number | null;
  inBudgets: number;
  outside: number;
  income: number;
  /** Income minus spending; negative when more went out than came in. */
  kept: number;
  /** Budget minus spending in budgets; negative when over, null with no budgets. */
  budgetLeft: number | null;
  overspends: {
    category: string;
    spent: number;
    limit: number;
    over: number;
    /** Average of the 3 months before, or null when there was nothing. */
    usual: number | null;
    payees: { payee: string; amount: number; count: number }[];
    largest: { id: string; payee: string; amount: number; date: string }[];
  }[];
  /** Top-level categories by spending, with their usual. */
  biggest: { category: string; spent: number; usual: number | null }[];
  uncategorised: { count: number; amount: number } | null;
  suggestions: { category: string; kind: SuggestionKind; current: number | null; suggested: number }[];
}

/** The AI's write-up for a month review: checked by the worker against the facts it was given. */
export interface MonthReviewWriteUp {
  summary: string;
  /** One per overspent budget at most, by the facts' category name. */
  causes: { category: string; text: string; transactionIds: string[] }[];
}

/** Paise to whole rupees for the facts, rounded half away from zero. */
export function wholeRupees(amount: Paise): number {
  return Math.sign(amount) * Math.round(Math.abs(amount) / 100);
}
