import { paise, type Paise } from './money';

/** A calendar month in the user's time zone, "2026-10". */
export type MonthKey = string;

/** Key used for the overall monthly budget (BUD-1), next to per-category budgets. */
export const OVERALL = '*';

export function monthKey(year: number, monthIndex: number): MonthKey {
  const d = new Date(year, monthIndex, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The month a moment falls in, on the phone's clock. */
export function monthOf(date: Date): MonthKey {
  return monthKey(date.getFullYear(), date.getMonth());
}

export function addMonths(month: MonthKey, count: number): MonthKey {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return monthKey(year, m - 1 + count);
}

/** Local start (inclusive) and end (exclusive) of a month, as ISO strings. */
export function monthBounds(month: MonthKey): { start: string; end: string } {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(year, m - 1, 1).toISOString(), end: new Date(year, m, 1).toISOString() };
}

/** How far through the month `now` is, from 0 to 1. */
export function monthElapsed(month: MonthKey, now: Date): number {
  const { start, end } = monthBounds(month);
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Math.min(1, Math.max(0, (now.getTime() - from) / (to - from)));
}

/**
 * One budget row (BUD-1). A row with no month is the category's default and
 * applies to every month; a row with a month overrides the default for that
 * month only. Removing the override brings the default back.
 */
export interface BudgetRow {
  month: MonthKey | null;
  /** null is the overall budget. */
  categoryId: string | null;
  limit: Paise;
}

export interface BudgetSetting {
  /** Applies to every month. */
  default: Paise | null;
  /** This month only, in place of the default. */
  override: Paise | null;
  /** What applies this month: the override, else the default. */
  limit: Paise | null;
}

/** Each category's default and override for `month`, keyed by category id or OVERALL. */
export function budgetSettings(rows: readonly BudgetRow[], month: MonthKey): Map<string, BudgetSetting> {
  const result = new Map<string, BudgetSetting>();
  for (const row of rows) {
    if (row.month !== null && row.month !== month) continue;
    const key = row.categoryId ?? OVERALL;
    const setting = result.get(key) ?? { default: null, override: null, limit: null };
    if (row.month === null) setting.default = row.limit;
    else setting.override = row.limit;
    setting.limit = setting.override ?? setting.default;
    result.set(key, setting);
  }
  return result;
}

/** The limit in force for each category in `month`, keyed by category id or OVERALL. */
export function effectiveBudgets(rows: readonly BudgetRow[], month: MonthKey): Map<string, Paise> {
  const result = new Map<string, Paise>();
  for (const [key, setting] of budgetSettings(rows, month)) if (setting.limit !== null) result.set(key, setting.limit);
  return result;
}

/**
 * BUD-1: the budgets that count in a month. A branch has either a budget on
 * the parent or budgets on its sub-categories, never both; if both exist (for
 * example from two phones), the parent's wins. The old overall budget is
 * ignored: the month's total is the sum of these.
 */
export function countedBudgets(limits: ReadonlyMap<string, Paise>, parentOf: ReadonlyMap<string, string | null>): Map<string, Paise> {
  const result = new Map<string, Paise>();
  for (const [id, limit] of limits) {
    if (id === OVERALL) continue;
    const parent = parentOf.get(id);
    if (parent && limits.has(parent)) continue;
    result.set(id, limit);
  }
  return result;
}

export interface BudgetTotal {
  /** The sum of the budgets that count, or null when none are set. */
  limit: Paise | null;
  /** Spent in budgeted categories; all spending when no budgets are set. */
  spent: Paise;
  /** Spent in categories without a budget. */
  outside: Paise;
}

/**
 * BUD-1: the month's total against the sum of its category budgets.
 * `spent` holds each category's spending with sub-categories rolled up
 * (see rollUp), `allSpending` the month's total spending.
 */
export function budgetTotal(counted: ReadonlyMap<string, Paise>, spent: ReadonlyMap<string, Paise>, allSpending: Paise): BudgetTotal {
  if (counted.size === 0) return { limit: null, spent: allSpending, outside: paise(0) };
  let limit = 0;
  let inBudgets = 0;
  for (const [id, amount] of counted) {
    limit += amount;
    inBudgets += spent.get(id) ?? 0;
  }
  return { limit: paise(limit), spent: paise(inBudgets), outside: paise(allSpending - inBudgets) };
}

/**
 * CAT-5: adds each sub-category's total into its parent. The result holds a
 * parent's own postings plus all its children's.
 */
export function rollUp(totals: ReadonlyMap<string, Paise>, parentOf: ReadonlyMap<string, string | null>): Map<string, Paise> {
  const result = new Map<string, number>();
  for (const [id, amount] of totals) {
    result.set(id, (result.get(id) ?? 0) + amount);
    const parent = parentOf.get(id);
    if (parent) result.set(parent, (result.get(parent) ?? 0) + amount);
  }
  return new Map([...result].map(([id, amount]) => [id, paise(amount)]));
}

export type PaceStatus = 'ok' | 'pace' | 'over';

export interface Pace {
  spent: Paise;
  limit: Paise;
  /** Spend at month end if it continues at the current rate. */
  projected: Paise;
  status: PaceStatus;
}

/** Below this share of the month, a few early payments (rent, EMIs) say little about pace. */
export const PACE_MIN_ELAPSED = 0.2;
/** BUD-2: warn when the month is on track to end this far over budget. */
export const PACE_TOLERANCE = 1.1;

/** BUD-2: whether spending is on track to go over the limit by month end. */
export function budgetPace(spent: Paise, limit: Paise, elapsed: number): Pace {
  const projected = paise(elapsed > 0 ? Math.round(spent / elapsed) : spent);
  let status: PaceStatus = 'ok';
  if (spent > limit) status = 'over';
  else if (elapsed >= PACE_MIN_ELAPSED && elapsed < 1 && projected > limit * PACE_TOLERANCE) status = 'pace';
  return { spent, limit, projected, status };
}

const SUGGESTION_STEP = 50_000; // ₹500

/**
 * First-run budget suggestion: the average of the given monthly totals,
 * rounded up to the next ₹500. Null when there was no spending.
 */
export function suggestBudget(monthlyTotals: readonly Paise[]): Paise | null {
  const months = monthlyTotals.length;
  if (months === 0) return null;
  const total = monthlyTotals.reduce((sum, amount) => sum + Math.max(0, amount), 0);
  if (total === 0) return null;
  return paise(Math.ceil(total / months / SUGGESTION_STEP) * SUGGESTION_STEP);
}

export interface SpendItem {
  transactionId: string;
  categoryId: string;
  counterparty: string | null;
  occurredAt: string;
  /** Positive for spending, negative for a refund. */
  amount: Paise;
}

export interface SpendBreakdown {
  total: Paise;
  byCategory: { categoryId: string; amount: Paise }[];
  byMerchant: { merchant: string; amount: Paise; count: number }[];
  largest: SpendItem[];
}

/** BUD-3: where a month's spending in one category tree went. Lists are sorted largest first. */
export function breakdown(items: readonly SpendItem[], options: { top?: number } = {}): SpendBreakdown {
  const top = options.top ?? 5;
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { amount: number; count: number }>();
  let total = 0;
  for (const item of items) {
    total += item.amount;
    byCategory.set(item.categoryId, (byCategory.get(item.categoryId) ?? 0) + item.amount);
    const merchant = item.counterparty?.trim() || 'Unknown';
    const entry = byMerchant.get(merchant) ?? { amount: 0, count: 0 };
    entry.amount += item.amount;
    entry.count += 1;
    byMerchant.set(merchant, entry);
  }
  return {
    total: paise(total),
    byCategory: [...byCategory]
      .map(([categoryId, amount]) => ({ categoryId, amount: paise(amount) }))
      .sort((a, b) => b.amount - a.amount),
    byMerchant: [...byMerchant]
      .map(([merchant, { amount, count }]) => ({ merchant, amount: paise(amount), count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, top),
    largest: [...items].sort((a, b) => b.amount - a.amount).slice(0, top),
  };
}

/** How the Budgets tab orders categories (BUD-2, decision 0013). */
export type BudgetSort = 'attention' | 'used' | 'budget' | 'spent' | 'name';

export const BUDGET_SORTS: readonly { key: BudgetSort; label: string }[] = [
  { key: 'attention', label: 'Needs attention' },
  { key: 'used', label: 'Most of budget used' },
  { key: 'budget', label: 'Biggest budget' },
  { key: 'spent', label: 'Most spent' },
  { key: 'name', label: 'Name' },
];

/** A category's numbers for sorting; a category budgeted through its sub-categories passes their totals and worst status. */
export interface SortableBudget {
  name: string;
  spent: Paise;
  limit: Paise | null;
  status: PaceStatus | null;
}

const ATTENTION: Record<PaceStatus, number> = { over: 0, pace: 1, ok: 2 };
const used = (b: SortableBudget) => (b.limit !== null && b.limit > 0 ? b.spent / b.limit : b.limit === 0 && b.spent > 0 ? Infinity : -1);
/** Over budget, then on pace to go over, then other budgets, then spending with no budget, then the rest. */
const attentionRank = (b: SortableBudget) => (b.status !== null && b.limit !== null ? ATTENTION[b.status] : b.spent > 0 ? 3 : 4);

/** Orders budget lines; ties fall back to the most spent, then the name. */
export function sortBudgets<T>(items: readonly T[], sort: BudgetSort, numbers: (item: T) => SortableBudget): T[] {
  const keyed = items.map((item) => ({ item, b: numbers(item) }));
  const byName = (a: SortableBudget, b: SortableBudget) => a.name.localeCompare(b.name);
  const bySpent = (a: SortableBudget, b: SortableBudget) => b.spent - a.spent || byName(a, b);
  const compare: Record<BudgetSort, (a: SortableBudget, b: SortableBudget) => number> = {
    attention: (a, b) => attentionRank(a) - attentionRank(b) || used(b) - used(a) || bySpent(a, b),
    used: (a, b) => used(b) - used(a) || bySpent(a, b),
    budget: (a, b) => (b.limit ?? -1) - (a.limit ?? -1) || bySpent(a, b),
    spent: bySpent,
    name: byName,
  };
  return keyed.sort((x, y) => compare[sort](x.b, y.b)).map((x) => x.item);
}

/** The numbers for a category budgeted through its sub-categories: their budgets added up and the worst status among them. */
export function combineBudgets(name: string, spent: Paise, children: readonly SortableBudget[]): SortableBudget {
  const budgeted = children.filter((c) => c.limit !== null);
  if (budgeted.length === 0) return { name, spent, limit: null, status: null };
  const status = budgeted.map((c) => c.status ?? 'ok').sort((a, b) => ATTENTION[a] - ATTENTION[b])[0]!;
  return { name, spent, limit: paise(budgeted.reduce((sum, c) => sum + c.limit!, 0)), status };
}
