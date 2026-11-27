import { currencyInfo, type CurrencyCode } from './currency';
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

/**
 * BUD-5 (decision 0034): the counted budgets with each one's carry from last
 * month added: a leftover carried in (positive) or an overspend taken off
 * (negative). A carry lands only on a budget that counts, and a budget never
 * goes below zero.
 */
export function withCarries(counted: ReadonlyMap<string, Paise>, carries: ReadonlyMap<string, Paise>): Map<string, Paise> {
  const result = new Map<string, Paise>();
  for (const [id, limit] of counted) result.set(id, paise(Math.max(0, limit + (carries.get(id) ?? 0))));
  return result;
}

export interface CarryQuestion {
  categoryId: string;
  /** Last month's budget minus what it spent: positive is left over, negative went over. */
  amount: Paise;
}

/**
 * BUD-5: what can carry from one month into the next. Every category whose
 * budget counted in both months (at the same level, BUD-1) and didn't land
 * exactly on its budget. `limits` are last month's budgets with their own
 * carries, so carried money can carry again.
 */
export function carryQuestions(
  limits: ReadonlyMap<string, Paise>,
  spent: ReadonlyMap<string, Paise>,
  nextCounted: ReadonlySet<string>,
): CarryQuestion[] {
  const result: CarryQuestion[] = [];
  for (const [categoryId, limit] of limits) {
    if (!nextCounted.has(categoryId)) continue;
    const amount = limit - (spent.get(categoryId) ?? 0);
    if (amount !== 0) result.push({ categoryId, amount: paise(amount) });
  }
  return result;
}

/**
 * BUD-5: an overspend the user chose to take off later budgets. It starts in
 * `into` and comes off month after month until cleared (decision 0034).
 */
export interface CarryDebt {
  id: string;
  /** The first month it comes off. */
  into: MonthKey;
  /** The whole overspend, positive. */
  amount: Paise;
  /** Null takes as much as each month's budget allows; 2 to 6 aims for equal parts over that many budgeted months. */
  spread: number | null;
  /** From this month on, whatever is left is dropped. */
  stoppedFrom: MonthKey | null;
}

export interface DebtMonth {
  /** Taken off this month's budget, per debt. */
  taken: Map<string, Paise>;
  /** Still to come off after this month, per debt; zero once cleared or stopped. */
  left: Map<string, Paise>;
}

/**
 * BUD-5: takes overspends off a category's budgets month by month, oldest
 * first, from its first month through `until`. `room` is what a month's
 * budget holds before overspends come off (the budget plus anything carried
 * in), or null when the category has no budget that month: overspends wait
 * for the next month with one. A month's budget never goes below zero; what
 * it can't take moves on. A spread debt aims, by its k-th budgeted month, to
 * have k/n of the amount taken (rounded up), so shortfalls catch up later and
 * anything left after n months comes off as needed.
 */
export function absorbDebts(debts: readonly CarryDebt[], room: (month: MonthKey) => number | null, until: MonthKey): Map<MonthKey, DebtMonth> {
  const result = new Map<MonthKey, DebtMonth>();
  if (debts.length === 0) return result;
  const order = [...debts].sort((a, b) => a.into.localeCompare(b.into) || a.id.localeCompare(b.id));
  const left = new Map<string, number>(order.map((d) => [d.id, d.amount]));
  const counted = new Map<string, number>(order.map((d) => [d.id, 0]));
  for (let month = order[0]!.into; month <= until; month = addMonths(month, 1)) {
    const taken = new Map<string, Paise>();
    for (const d of order) if (d.stoppedFrom !== null && month >= d.stoppedFrom) left.set(d.id, 0);
    const budget = room(month);
    if (budget !== null) {
      let free = Math.max(0, budget);
      for (const d of order) {
        const owed = left.get(d.id)!;
        if (d.into > month || owed <= 0) continue;
        const k = counted.get(d.id)! + 1;
        counted.set(d.id, k);
        const due = d.spread !== null && k < d.spread ? Math.max(0, Math.ceil((d.amount * k) / d.spread) - (d.amount - owed)) : owed;
        const take = Math.min(due, free);
        if (take <= 0) continue;
        free -= take;
        left.set(d.id, owed - take);
        taken.set(d.id, paise(take));
      }
    }
    result.set(month, { taken, left: new Map([...left].map(([id, amount]) => [id, paise(amount)])) });
  }
  return result;
}

/** BUD-5: the last month an overspend comes off within the months worked out; null if it doesn't clear in them. */
export function debtClearsBy(debtId: string, months: ReadonlyMap<MonthKey, DebtMonth>): MonthKey | null {
  let last: MonthKey | null = null;
  for (const [month, state] of months) {
    if ((state.taken.get(debtId) ?? 0) > 0) last = month;
    if ((state.left.get(debtId) ?? 0) === 0) return last;
  }
  return null;
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
 * How far a suggested budget rounds up in a currency, in its minor units:
 * ₹500, 1,000 of a currency without decimals (yen, won), else 10 (decision 0017).
 */
export function suggestionStep(currency: CurrencyCode): number {
  if (currency === 'INR') return SUGGESTION_STEP;
  const { decimals } = currencyInfo(currency);
  return decimals === 0 ? 1000 : 10 * 10 ** decimals;
}

/**
 * First-run budget suggestion: the average of the given monthly totals,
 * rounded up to the next `step` (₹500 by default; see suggestionStep for
 * other currencies). Null when there was no spending.
 */
export function suggestBudget(monthlyTotals: readonly Paise[], step: number = SUGGESTION_STEP): Paise | null {
  const months = monthlyTotals.length;
  if (months === 0) return null;
  const total = monthlyTotals.reduce((sum, amount) => sum + Math.max(0, amount), 0);
  if (total === 0) return null;
  return paise(Math.ceil(total / months / step) * step);
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

/** Days in a month, 28 to 31. */
export function daysInMonth(month: MonthKey): number {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(year, m, 0).getDate();
}

/**
 * BUD-3 (decision 0038): spending added up day by day, on the phone's clock,
 * for the pace chart: index 0 is the 1st. Runs through `throughDay` (the
 * month's last day when left out); a refund brings the line down.
 */
export function runningTotals(items: readonly Pick<SpendItem, 'occurredAt' | 'amount'>[], month: MonthKey, throughDay = daysInMonth(month)): Paise[] {
  const days = Math.max(0, Math.min(throughDay, daysInMonth(month)));
  const perDay = new Array<number>(days).fill(0);
  for (const item of items) {
    const day = new Date(item.occurredAt).getDate();
    if (day <= days) perDay[day - 1]! += item.amount;
  }
  let sum = 0;
  return perDay.map((amount) => paise((sum += amount)));
}

/** Spent from the 1st through `day` of the month; a day past the month's end counts the whole month. */
export function spentThrough(items: readonly Pick<SpendItem, 'occurredAt' | 'amount'>[], month: MonthKey, day: number): Paise {
  return runningTotals(items, month, day).at(-1) ?? paise(0);
}

/**
 * BUD-3 (decision 0038): one entry that makes up a large part of the month,
 * worth calling out: at least a quarter of the total, with other entries
 * beside it. Null otherwise.
 */
export function standout(items: readonly SpendItem[]): { item: SpendItem; share: number; without: Paise } | null {
  if (items.length < 2) return null;
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  if (total <= 0) return null;
  const item = items.reduce((best, i) => (i.amount > best.amount ? i : best));
  const share = item.amount / total;
  return share >= 0.25 ? { item, share, without: paise(total - item.amount) } : null;
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
