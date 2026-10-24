import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import {
  OVERALL,
  addMonths,
  breakdown,
  budgetPace,
  budgetSettings,
  monthBounds,
  monthElapsed,
  monthOf,
  paise,
  rollUp,
  suggestBudget,
  type MonthKey,
  type BudgetSetting,
  type Pace,
  type Paise,
  type SpendBreakdown,
} from '@money-plant/core';
import { budgets, postings, transactions } from '@money-plant/db-schema';
import { formatWholeRupees as rupees } from '@/components/format';
import { flatten, listCategories, type CategoryNode } from './categories';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { derivedId } from './ids';
import { kvGet, kvSet } from './kv';
import { notify } from './notifications';

const now = () => new Date().toISOString();

export function currentMonth(): MonthKey {
  return monthOf(new Date());
}

/** Days left in the current month, today included; null for any other month. */
export function daysLeft(month: MonthKey): number | null {
  if (month !== currentMonth()) return null;
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate() + 1;
}

/** Spending per category in a month: postings on spending categories, refunds subtracted. */
async function spendByCategory(month: MonthKey, spending: ReadonlySet<string>): Promise<Map<string, Paise>> {
  const db = await getDb();
  const { start, end } = monthBounds(month);
  const rows = db
    .select({ accountId: postings.accountId, amount: postings.amountPaise })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(isNull(transactions.deletedAt), gte(transactions.occurredAt, start), lt(transactions.occurredAt, end)))
    .all();
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!spending.has(row.accountId)) continue;
    totals.set(row.accountId, (totals.get(row.accountId) ?? 0) + row.amount);
  }
  return new Map([...totals].map(([id, amount]) => [id, paise(amount)]));
}

export interface BudgetLine {
  category: CategoryNode | null;
  /** Spent this month, sub-categories included (CAT-5). */
  spent: Paise;
  limit: Paise | null;
  /** The every-month default and this month's override behind `limit`. */
  setting: BudgetSetting;
  pace: Pace | null;
}

export interface MonthOverview {
  month: MonthKey;
  elapsed: number;
  overall: BudgetLine;
  /** Top-level spending categories, each followed by its sub-categories. */
  lines: BudgetLine[];
  /** Invested or withdrawn as cash: shown, but not counted as spending. */
  moved: { category: CategoryNode; amount: Paise }[];
}

/**
 * Money that leaves an account without being spent: investing it, or taking it
 * out as cash (whose spends are logged from the Cash account). These stay
 * categories the user can pick, but don't count toward spending or budgets.
 */
const NOT_SPENDING = new Set(['investments', 'cash']);

const isSpending = (category: CategoryNode) => !NOT_SPENDING.has((category.key ?? '').split('.')[0]!);

async function spendingTree() {
  const expense = (await listCategories()).filter((c) => c.flow === 'expense');
  const tree = expense.filter(isSpending);
  const all = flatten(tree);
  const moved = expense.filter((c) => !isSpending(c));
  return { tree, all, moved, ids: new Set(all.map((c) => c.id)), parents: new Map(all.map((c) => [c.id, c.parentId])) };
}

/** What left the user's accounts this month as investments or cash, per top-level category. */
async function movedThisMonth(month: MonthKey, moved: CategoryNode[]): Promise<{ category: CategoryNode; amount: Paise }[]> {
  const all = flatten(moved);
  const totals = rollUp(await spendByCategory(month, new Set(all.map((c) => c.id))), new Map(all.map((c) => [c.id, c.parentId])));
  return moved.map((category) => ({ category, amount: totals.get(category.id) ?? paise(0) })).filter((m) => m.amount > 0);
}

/**
 * HOME-1: money in this month, from postings on income categories. Transfers
 * between the user's accounts and IOU repayments never touch a category, so
 * they are left out; refunds sit on spending categories and reduce spending.
 */
export async function incomeThisMonth(month: MonthKey): Promise<Paise> {
  const income = flatten((await listCategories()).filter((c) => c.flow === 'income'));
  const totals = await spendByCategory(month, new Set(income.map((c) => c.id)));
  // Income categories are credited, so their postings are negative.
  return paise(-[...totals.values()].reduce((sum, amount) => sum + amount, 0));
}

function budgetRows(db: Awaited<ReturnType<typeof getDb>>) {
  return db
    .select()
    .from(budgets)
    .where(isNull(budgets.deletedAt))
    .all()
    .flatMap((row) => (row.limitPaise === null ? [] : [{ month: row.month, categoryId: row.categoryAccountId, limit: paise(row.limitPaise) }]));
}

const NO_SETTING: BudgetSetting = { default: null, override: null, limit: null };

/** BUD-1 and BUD-2: spend against budget for every spending category in a month. */
export async function monthOverview(month: MonthKey): Promise<MonthOverview> {
  const db = await getDb();
  const { tree, ids, parents, moved } = await spendingTree();
  const spent = rollUp(await spendByCategory(month, ids), parents);
  const settings = budgetSettings(budgetRows(db), month);
  const elapsed = month === currentMonth() ? monthElapsed(month, new Date()) : month < currentMonth() ? 1 : 0;
  const line = (category: CategoryNode | null): BudgetLine => {
    const key = category?.id ?? OVERALL;
    const amount =
      category === null
        ? paise(tree.reduce((sum, root) => sum + (spent.get(root.id) ?? 0), 0))
        : (spent.get(category.id) ?? paise(0));
    const setting = settings.get(key) ?? NO_SETTING;
    const limit = setting.limit;
    return { category, spent: amount, limit, setting, pace: limit === null ? null : budgetPace(amount, limit, elapsed) };
  };
  return {
    month,
    elapsed,
    overall: line(null),
    lines: tree.flatMap((root) => [line(root), ...root.children.map(line)]),
    moved: await movedThisMonth(month, moved),
  };
}

/**
 * BUD-1: sets (or with null, removes) a budget. With no month it is the
 * default for every month; with a month it overrides the default for that
 * month only, and null resets the month to the default.
 */
export async function setBudget(month: MonthKey | null, categoryId: string | null, limit: Paise | null): Promise<void> {
  const db = await getDb();
  const id = await derivedId(`budget:${month ?? 'default'}:${categoryId ?? 'overall'}`);
  const values = { month, categoryAccountId: categoryId, limitPaise: limit, deletedAt: limit === null ? now() : null, dirty: 1 };
  db.insert(budgets)
    .values({ id, ...values, createdAt: now() })
    .onConflictDoUpdate({ target: budgets.id, set: { ...values, rev: sql`${budgets.rev} + 1` } })
    .run();
  notifyLedgerChange();
}

/** First-run budgets: per category, the average of the last 3 full months rounded up to ₹500. */
export async function suggestBudgets(month: MonthKey): Promise<Map<string, Paise>> {
  const { tree, ids, parents } = await spendingTree();
  const months = [1, 2, 3].map((n) => addMonths(month, -n));
  const totals = await Promise.all(months.map(async (m) => rollUp(await spendByCategory(m, ids), parents)));
  const result = new Map<string, Paise>();
  for (const category of flatten(tree)) {
    if (category.system) continue;
    const suggestion = suggestBudget(totals.map((t) => t.get(category.id) ?? paise(0)));
    if (suggestion !== null) result.set(category.id, suggestion);
  }
  const overall = suggestBudget(totals.map((t) => paise(tree.reduce((sum, root) => sum + (t.get(root.id) ?? 0), 0))));
  if (overall !== null) result.set(OVERALL, overall);
  return result;
}

export interface CategoryBreakdown extends SpendBreakdown {
  /** Average over the 3 months before, for comparison (BUD-3). */
  previousAverage: Paise;
  /** The month and the 3 before it, oldest first. */
  history: { month: MonthKey; total: Paise }[];
}

/**
 * BUD-3: where a category's (or with null, all) spending went in a month. An
 * income category works too, with what came in counted as positive.
 */
export async function categoryBreakdown(month: MonthKey, categoryId: string | null): Promise<CategoryBreakdown> {
  const db = await getDb();
  const { ids } = await spendingTree();
  const all = flatten(await listCategories());
  const income = categoryId !== null && all.find((c) => c.id === categoryId)?.flow === 'income';
  const inTree = new Set(
    categoryId === null ? ids : all.filter((c) => c.id === categoryId || c.parentId === categoryId).map((c) => c.id),
  );
  const itemsFor = (m: MonthKey) => {
    const { start, end } = monthBounds(m);
    return db
      .select({
        transactionId: transactions.id,
        categoryId: postings.accountId,
        counterparty: transactions.counterparty,
        occurredAt: transactions.occurredAt,
        amount: postings.amountPaise,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(isNull(transactions.deletedAt), gte(transactions.occurredAt, start), lt(transactions.occurredAt, end)))
      .all()
      .filter((row) => inTree.has(row.categoryId))
      // Income categories are credited, so their postings are negative.
      .map((row) => ({ ...row, amount: paise(income ? -row.amount : row.amount) }));
  };
  const result = breakdown(itemsFor(month));
  const history = [3, 2, 1].map((n) => addMonths(month, -n)).map((m) => ({ month: m, total: breakdown(itemsFor(m)).total }));
  const previousAverage = paise(Math.round(history.reduce((sum, h) => sum + h.total, 0) / history.length));
  return { ...result, previousAverage, history: [...history, { month, total: result.total }] };
}

/** Money in per top-level income category in a month, sub-categories included, largest first. */
export async function incomeByCategory(month: MonthKey): Promise<{ category: CategoryNode; amount: Paise }[]> {
  const tree = (await listCategories()).filter((c) => c.flow === 'income');
  const all = flatten(tree);
  const totals = rollUp(await spendByCategory(month, new Set(all.map((c) => c.id))), new Map(all.map((c) => [c.id, c.parentId])));
  return tree
    .map((category) => ({ category, amount: paise(-(totals.get(category.id) ?? 0)) }))
    .filter((line) => line.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
}

/**
 * BUD-2: a notification the first time in a month a budget goes on pace to
 * overspend, and again when it goes over. Runs after captures.
 */
export async function checkPaceAlerts(): Promise<void> {
  const month = currentMonth();
  const overview = await monthOverview(month);
  for (const line of [overview.overall, ...overview.lines]) {
    if (!line.pace || line.pace.status === 'ok' || line.limit === null) continue;
    const key = `budget.alert.${month}.${line.category?.id ?? 'overall'}.${line.pace.status}`;
    if (await kvGet(key)) continue;
    await kvSet(key, '1');
    const name = line.category?.name ?? 'Your monthly budget';
    await notify({
      channel: 'budgets',
      title: line.pace.status === 'over' ? `${name} is over budget` : `${name} is on pace to overspend`,
      body:
        line.pace.status === 'over'
          ? `Spent ${rupees(line.spent)} of ${rupees(line.limit)} this month.`
          : `Spent ${rupees(line.spent)} of ${rupees(line.limit)}; at this rate the month ends near ${rupees(line.pace.projected)}.`,
      data: { url: line.category ? `/budget/${line.category.id}` : '/budget/overall' },
    });
  }
}

