import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  addMonths,
  breakdown,
  budgetPace,
  budgetSettings,
  budgetTotal,
  carryQuestions,
  countedBudgets,
  monthBounds,
  monthElapsed,
  monthOf,
  paise,
  rollUp,
  runningTotals,
  spentThrough,
  dateKey,
  suggestBudget,
  suggestionStep,
  withCarries,
  absorbDebts,
  debtClearsBy,
  type CarryDebt,
  type MonthKey,
  type BudgetSetting,
  type CurrencyCode,
  type DateKey,
  type Pace,
  type Paise,
  type SpendBreakdown,
} from '@money-plant/core';
import { groupPlaces, type Place } from '@money-plant/categoriser';
import { budgetCarries, budgets, postings, transactions } from '@money-plant/db-schema';
import { cleanCounterparty } from '@money-plant/parser';
import { formatAmount as rupees, formatMonth } from '@/components/format';
import { flatten, listCategories, type CategoryNode } from './categories';
import { getDb } from './db';
import { homeCurrency } from './home-currency';
import { homeConverter } from './home-money';
import { notifyLedgerChange } from './events';
import { derivedId } from './ids';
import { kvGet, kvSet } from './kv';
import { listTransactions } from './ledger';
import { listRecurring } from './recurring';
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

/**
 * Spending per category in a month: postings on spending categories, refunds
 * subtracted. In the home currency, each entry at its own day's rate
 * (decision 0017); entries whose rate isn't known yet go in `missing`.
 */
async function spendByCategory(month: MonthKey, spending: ReadonlySet<string>, missing?: Set<CurrencyCode>): Promise<Map<string, Paise>> {
  const db = await getDb();
  const { start, end } = monthBounds(month);
  const rows = db
    .select({ accountId: postings.accountId, amount: postings.amountPaise, currency: postings.currency, occurredAt: transactions.occurredAt })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(isNull(transactions.deletedAt), gte(transactions.occurredAt, start), lt(transactions.occurredAt, end)))
    .all()
    .filter((row) => spending.has(row.accountId));
  const converter = await homeConverter(rows);
  const totals = new Map<string, number>();
  for (const row of rows) {
    const amount = converter.toHome(row.amount, row.currency, row.occurredAt);
    if (amount === null) continue;
    totals.set(row.accountId, (totals.get(row.accountId) ?? 0) + amount);
  }
  for (const currency of converter.missing) missing?.add(currency);
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
  /** A sub-category whose parent has the budget: it counts there, not on its own (BUD-1). */
  inParentBudget: boolean;
  /** BUD-5: last month's leftover carried into `limit`, or null. */
  carriedIn: Paise | null;
  /** BUD-5: earlier overspends taken off `limit` this month, or null. */
  takenOff: Paise | null;
  /** BUD-5: overspends taken off this month or still to come off later. */
  overspends: OverspendDebt[];
}

/** BUD-5 (decision 0034): an overspend coming off a category's budgets. */
export interface OverspendDebt {
  /** The carry row; changing its plan stops it and starts a row that continues it. */
  id: string;
  /** The month that went over. */
  from: MonthKey;
  /** The first month this row comes off. */
  into: MonthKey;
  /** Taken off the month in view. */
  taken: Paise;
  /** Still to come off after the month in view. */
  left: Paise;
  /** The last month it comes off, with today's budgets; null when no budget ahead takes it all. */
  clearsBy: MonthKey | null;
  /** Null as needed, else equal parts over that many months. */
  spread: number | null;
}

export interface MonthOverview {
  month: MonthKey;
  elapsed: number;
  /**
   * The month's total: the sum of the category budgets against what was spent
   * in those categories. With no budgets set, all spending and no limit.
   */
  overall: BudgetLine;
  /** Spent in categories without a budget; shown apart, not against the total (BUD-1). */
  outside: Paise;
  /** Top-level spending categories, each followed by its sub-categories. */
  lines: BudgetLine[];
  /** Invested or withdrawn as cash: shown, but not counted as spending. */
  moved: { category: CategoryNode; amount: Paise }[];
  /** Currencies whose entries are left out because their rate isn't known yet (NW-7). */
  missingRates: CurrencyCode[];
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

type CarryRow = typeof budgetCarries.$inferSelect;

function carryRowsAll(db: Awaited<ReturnType<typeof getDb>>): CarryRow[] {
  return db.select().from(budgetCarries).where(isNull(budgetCarries.deletedAt)).all();
}

/** BUD-5: every answer to a month's carry question, keyed by category; zero is "Leave it". Rows continuing an earlier overspend aren't answers. */
function carryAnswers(rows: readonly CarryRow[], month: MonthKey): Map<string, CarryRow> {
  return new Map(rows.filter((r) => r.month === month && r.continuesId === null).map((r) => [r.categoryAccountId, r]));
}

/** How far ahead overspends are followed to say when they clear. */
const DEBT_HORIZON = 120;

/**
 * BUD-5: what carries do to one month's counted budgets. A leftover carried in
 * adds to its month; overspends come off month after month, as each budget
 * allows or spread, until cleared or stopped (absorbDebts).
 */
function applyCarries(
  month: MonthKey,
  base: ReadonlyMap<string, Paise>,
  rows: readonly CarryRow[],
  countedIn: (m: MonthKey) => ReadonlyMap<string, Paise>,
): { limits: Map<string, Paise>; carriedIn: Map<string, Paise>; takenOff: Map<string, Paise>; overspends: Map<string, OverspendDebt[]> } {
  const carriedIn = new Map<string, Paise>();
  const positive = (m: MonthKey, id: string) => {
    const row = rows.find((r) => r.month === m && r.categoryAccountId === id && r.continuesId === null && r.amountPaise > 0);
    return row ? row.amountPaise : 0;
  };
  for (const id of base.keys()) {
    const carried = positive(month, id);
    if (carried > 0) carriedIn.set(id, paise(carried));
  }
  const limits = withCarries(base, carriedIn);
  const takenOff = new Map<string, Paise>();
  const overspends = new Map<string, OverspendDebt[]>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const origin = (row: CarryRow): MonthKey => {
    let at = row;
    for (let hops = 0; at.continuesId && byId.has(at.continuesId) && hops < 50; hops++) at = byId.get(at.continuesId)!;
    return addMonths(at.month, -1);
  };
  const next = addMonths(month, 1);
  const categories = new Set(rows.filter((r) => r.amountPaise < 0).map((r) => r.categoryAccountId));
  for (const id of categories) {
    const own = rows.filter((r) => r.categoryAccountId === id && r.amountPaise < 0 && r.month <= next);
    if (own.length === 0) continue;
    const debts: CarryDebt[] = own.map((r) => ({ id: r.id, into: r.month, amount: paise(-r.amountPaise), spread: r.spreadMonths, stoppedFrom: r.stoppedFrom }));
    const room = (m: MonthKey) => {
      const budget = countedIn(m).get(id);
      return budget === undefined ? null : Math.max(0, budget + positive(m, id));
    };
    const months = absorbDebts(debts, room, addMonths(month, DEBT_HORIZON));
    const now = months.get(month);
    const taken = now ? [...now.taken.values()].reduce((sum, v) => sum + v, 0) : 0;
    if (taken > 0 && limits.has(id)) {
      takenOff.set(id, paise(taken));
      limits.set(id, paise(limits.get(id)! - taken));
    }
    const list: OverspendDebt[] = [];
    for (const row of own) {
      const takenNow = now?.taken.get(row.id) ?? paise(0);
      const left = row.month > month ? paise(-row.amountPaise) : (now?.left.get(row.id) ?? paise(0));
      const stopped = row.stoppedFrom !== null && row.stoppedFrom <= next;
      if (takenNow === 0 && (left === 0 || stopped)) continue;
      list.push({ id: row.id, from: origin(row), into: row.month, taken: takenNow, left: stopped ? paise(0) : left, clearsBy: debtClearsBy(row.id, months), spread: row.spreadMonths });
    }
    if (list.length > 0) overspends.set(id, list);
  }
  return { limits, carriedIn, takenOff, overspends };
}

/** BUD-1 and BUD-2: spend against budget for every spending category in a month. */
export async function monthOverview(month: MonthKey): Promise<MonthOverview> {
  const db = await getDb();
  const { tree, ids, parents, moved } = await spendingTree();
  const missing = new Set<CurrencyCode>();
  const spent = rollUp(await spendByCategory(month, ids, missing), parents);
  const settings = budgetSettings(budgetRows(db), month);
  const limits = new Map<string, Paise>();
  for (const [key, setting] of settings) if (setting.limit !== null && ids.has(key)) limits.set(key, setting.limit);
  const base = countedBudgets(limits, parents);
  // BUD-5: leftovers carried in and overspends coming off, where the user chose to carry them.
  const rows = budgetRows(db);
  const countedCache = new Map<MonthKey, Map<string, Paise>>([[month, base]]);
  const countedIn = (m: MonthKey) => {
    let found = countedCache.get(m);
    if (!found) {
      const own = new Map<string, Paise>();
      for (const [key, setting] of budgetSettings(rows, m)) if (setting.limit !== null && ids.has(key)) own.set(key, setting.limit);
      found = countedBudgets(own, parents);
      countedCache.set(m, found);
    }
    return found;
  };
  const carried = applyCarries(month, base, carryRowsAll(db), countedIn);
  const counted = carried.limits;
  const allSpending = paise(tree.reduce((sum, root) => sum + (spent.get(root.id) ?? 0), 0));
  const total = budgetTotal(counted, spent, allSpending);
  const elapsed = month === currentMonth() ? monthElapsed(month, new Date()) : month < currentMonth() ? 1 : 0;
  const line = (category: CategoryNode): BudgetLine => {
    const amount = spent.get(category.id) ?? paise(0);
    const setting = settings.get(category.id) ?? NO_SETTING;
    const limit = counted.get(category.id) ?? null;
    const inParentBudget = category.parentId !== null && counted.has(category.parentId);
    return {
      category,
      spent: amount,
      limit,
      setting,
      pace: limit === null ? null : budgetPace(amount, limit, elapsed),
      inParentBudget,
      carriedIn: carried.carriedIn.get(category.id) ?? null,
      takenOff: carried.takenOff.get(category.id) ?? null,
      overspends: carried.overspends.get(category.id) ?? [],
    };
  };
  return {
    month,
    elapsed,
    overall: {
      category: null,
      spent: total.spent,
      limit: total.limit,
      setting: NO_SETTING,
      pace: total.limit === null ? null : budgetPace(total.spent, total.limit, elapsed),
      inParentBudget: false,
      carriedIn: null,
      takenOff: null,
      overspends: [],
    },
    outside: total.outside,
    lines: tree.flatMap((root) => [line(root), ...root.children.map(line)]),
    moved: await movedThisMonth(month, moved),
    missingRates: [...missing],
  };
}

export interface CarryChoice {
  category: CategoryNode;
  /** The month the carry lands in: the month after the one reviewed. */
  into: MonthKey;
  /** What it would carry now: left over (positive) or over (negative). */
  amount: Paise;
  /** What the user chose, fixed when they answered: the carried amount, 0 to leave it, null not yet. */
  answer: Paise | null;
  /** For an overspend taken off: null as needed, else equal parts over that many months. */
  spread: number | null;
}

/**
 * BUD-5 (decision 0034): the carry questions for `from`, asked only while the
 * month after it is the current month. One per category budgeted in both
 * months that didn't land exactly on its budget. Pass the two overviews when
 * the caller already has them.
 */
export async function carryChoices(from: MonthKey, loaded: { from?: MonthOverview; into?: MonthOverview } = {}): Promise<CarryChoice[]> {
  const into = addMonths(from, 1);
  if (into !== currentMonth()) return [];
  const [before, after] = await Promise.all([loaded.from ?? monthOverview(from), loaded.into ?? monthOverview(into)]);
  const counted = (o: MonthOverview) => o.lines.filter((l) => l.limit !== null && !l.category!.system);
  const limits = new Map(counted(before).map((l) => [l.category!.id, l.limit!]));
  const spent = new Map(before.lines.map((l) => [l.category!.id, l.spent]));
  const next = new Set(counted(after).map((l) => l.category!.id));
  const answers = carryAnswers(carryRowsAll(await getDb()), into);
  const byId = new Map(before.lines.map((l) => [l.category!.id, l.category!]));
  return carryQuestions(limits, spent, next).map((q) => {
    const row = answers.get(q.categoryId);
    return { category: byId.get(q.categoryId)!, into, amount: q.amount, answer: row ? paise(row.amountPaise) : null, spread: row?.spreadMonths ?? null };
  });
}

/**
 * BUD-5: answers carry questions: carry each amount as it stands now, or with
 * `leave`, carry nothing. An overspend taken off comes off as needed, or in
 * equal parts over `spread` months. Answering again replaces any change of
 * plan made since.
 */
export async function answerCarries(choices: readonly CarryChoice[], leave = false, spread: number | null = null): Promise<void> {
  if (choices.length === 0) return;
  const db = await getDb();
  const rows = await Promise.all(
    choices.map(async (c) => ({
      id: await derivedId(`carry:${c.into}:${c.category.id}`),
      month: c.into,
      categoryAccountId: c.category.id,
      amountPaise: leave ? 0 : c.amount,
      spreadMonths: !leave && c.amount < 0 ? spread : null,
      stoppedFrom: null,
      continuesId: null,
    })),
  );
  db.transaction((t) => {
    for (const row of rows) {
      const values = { ...row, deletedAt: null, dirty: 1 };
      t.insert(budgetCarries)
        .values({ ...values, createdAt: now() })
        .onConflictDoUpdate({ target: budgetCarries.id, set: { ...values, rev: sql`${budgetCarries.rev} + 1` } })
        .run();
      t.update(budgetCarries)
        .set({ deletedAt: now(), dirty: 1, rev: sql`${budgetCarries.rev} + 1` })
        .where(and(eq(budgetCarries.continuesId, row.id), isNull(budgetCarries.deletedAt)))
        .run();
    }
  });
  notifyLedgerChange();
}

/**
 * BUD-5: changes how what's left of an overspend comes off, from next month
 * on: as needed (null) or in equal parts over `spread` months. What came off
 * up to this month stays as it was: the row stops after this month and a new
 * row continues it with the rest.
 */
export async function changeOverspend(debt: OverspendDebt, spread: number | null): Promise<void> {
  const db = await getDb();
  const next = addMonths(currentMonth(), 1);
  const row = db.select().from(budgetCarries).where(eq(budgetCarries.id, debt.id)).get();
  if (!row) return;
  const bump = { dirty: 1, rev: sql`${budgetCarries.rev} + 1` };
  if (row.month >= next) {
    // Not started yet: change it in place.
    db.update(budgetCarries).set({ spreadMonths: spread, ...bump }).where(eq(budgetCarries.id, row.id)).run();
  } else if (debt.left > 0) {
    const id = await derivedId(`carry:rest:${row.id}:${next}`);
    const values = { month: next, categoryAccountId: row.categoryAccountId, amountPaise: -debt.left, spreadMonths: spread, stoppedFrom: null, continuesId: row.id, deletedAt: null, dirty: 1 };
    db.transaction((t) => {
      t.update(budgetCarries).set({ stoppedFrom: next, ...bump }).where(eq(budgetCarries.id, row.id)).run();
      t.insert(budgetCarries)
        .values({ id, ...values, createdAt: now() })
        .onConflictDoUpdate({ target: budgetCarries.id, set: { ...values, rev: sql`${budgetCarries.rev} + 1` } })
        .run();
    });
  }
  notifyLedgerChange();
}

/** BUD-5: stops carrying what's left of an overspend from next month on; what already came off stays. */
export async function stopOverspend(debt: OverspendDebt): Promise<void> {
  const db = await getDb();
  const next = addMonths(currentMonth(), 1);
  db.update(budgetCarries)
    .set({ stoppedFrom: debt.into > next ? debt.into : next, dirty: 1, rev: sql`${budgetCarries.rev} + 1` })
    .where(eq(budgetCarries.id, debt.id))
    .run();
  notifyLedgerChange();
}

const shortMonth = (month: MonthKey) => formatMonth(month).split(' ')[0]!;

/** BUD-5: how an overspend comes off, for a sheet or a note. */
export function spreadText(spread: number | null): string {
  return spread === null ? 'as each budget allows' : `over ${spread} months`;
}

/** BUD-5: what carries did to a month's budget, for under its bar; null when nothing. */
export function carryText(line: BudgetLine, month: MonthKey): string | null {
  const parts: string[] = [];
  if (line.carriedIn !== null) parts.push(`Includes ${rupees(line.carriedIn)} carried from ${shortMonth(addMonths(month, -1))}`);
  if (line.takenOff !== null) {
    const origins = [...new Set(line.overspends.filter((d) => d.taken > 0).map((d) => d.from))];
    parts.push(`${rupees(line.takenOff)} taken off for ${origins.length === 1 ? `${shortMonth(origins[0]!)}'s overspend` : 'earlier overspends'}`);
  }
  const left = line.overspends.reduce((sum, d) => sum + d.left, 0);
  if (left > 0) {
    const ends = line.overspends.filter((d) => d.left > 0).map((d) => d.clearsBy);
    const last = ends.includes(null) ? null : ends.reduce((a, b) => (a! > b! ? a : b));
    parts.push(`${rupees(paise(left))} more ${last ? `comes off by ${shortMonth(last)}` : 'to come off'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export type BudgetConflict =
  | { kind: 'children'; names: string[]; sum: Paise }
  | { kind: 'parent'; name: string };

/**
 * BUD-1: what setting a budget on `categoryId` would replace. A parent
 * budget replaces its sub-categories' budgets (`sum` is their every-month
 * total, offered as the parent's amount); a sub-category budget replaces
 * its parent's.
 */
export async function budgetConflict(categoryId: string): Promise<BudgetConflict | null> {
  const db = await getDb();
  const { all } = await spendingTree();
  const category = all.find((c) => c.id === categoryId);
  if (!category) return null;
  const rows = budgetRows(db);
  if (category.parentId === null) {
    const children = all.filter((c) => c.parentId === categoryId && rows.some((r) => r.categoryId === c.id));
    if (children.length === 0) return null;
    const sum = rows.filter((r) => r.month === null && children.some((c) => c.id === r.categoryId)).reduce((total, r) => total + r.limit, 0);
    return { kind: 'children', names: children.map((c) => c.name), sum: paise(sum) };
  }
  const parent = all.find((c) => c.id === category.parentId);
  return parent && rows.some((r) => r.categoryId === parent.id) ? { kind: 'parent', name: parent.name } : null;
}

/**
 * BUD-1: sets (or with null, removes) a budget. With no month it is the
 * default for every month; with a month it overrides the default for that
 * month only, and null resets the month to the default. Setting an amount
 * removes the budgets it would overlap: a parent's sub-category budgets, or
 * a sub-category's parent budget, in every month (see budgetConflict).
 */
export async function setBudget(month: MonthKey | null, categoryId: string, limit: Paise | null): Promise<void> {
  const db = await getDb();
  const id = await derivedId(`budget:${month ?? 'default'}:${categoryId}`);
  const values = { month, categoryAccountId: categoryId, limitPaise: limit, deletedAt: limit === null ? now() : null, dirty: 1 };
  const overlapping =
    limit === null
      ? []
      : (await spendingTree()).all.filter((c) => c.parentId === categoryId || c.children.some((child) => child.id === categoryId)).map((c) => c.id);
  db.transaction((t) => {
    t.insert(budgets)
      .values({ id, ...values, createdAt: now() })
      .onConflictDoUpdate({ target: budgets.id, set: { ...values, rev: sql`${budgets.rev} + 1` } })
      .run();
    if (overlapping.length > 0) {
      t.update(budgets)
        .set({ deletedAt: now(), dirty: 1, rev: sql`${budgets.rev} + 1` })
        .where(and(isNull(budgets.deletedAt), inArray(budgets.categoryAccountId, overlapping)))
        .run();
    }
  });
  notifyLedgerChange();
}

/** First-run budgets: per top-level category, the average of the last 3 full months rounded up to 500 of the home currency. */
export async function suggestBudgets(month: MonthKey): Promise<Map<string, Paise>> {
  const { tree, ids, parents } = await spendingTree();
  const months = [1, 2, 3].map((n) => addMonths(month, -n));
  const totals = await Promise.all(months.map(async (m) => rollUp(await spendByCategory(m, ids), parents)));
  const step = suggestionStep(homeCurrency());
  const result = new Map<string, Paise>();
  for (const category of tree) {
    if (category.system) continue;
    const suggestion = suggestBudget(totals.map((t) => t.get(category.id) ?? paise(0)), step);
    if (suggestion !== null) result.set(category.id, suggestion);
  }
  return result;
}

export interface CategoryBreakdown extends SpendBreakdown {
  /** Average over the 3 months before, for comparison (BUD-3). */
  previousAverage: Paise;
  /** The month and the 5 before it (3 for the month review), oldest first. */
  history: { month: MonthKey; total: Paise }[];
  /** BUD-3 (decision 0038): the month's entries in this budget, newest first. */
  entries: BudgetEntry[];
  /** Spending added up day by day through today (or the whole month once it's over); index 0 is the 1st. */
  running: Paise[];
  /** This month only: spent last month by the same day of the month. */
  lastMonthByNow: Paise | null;
  /** This month only: recurring payments in this budget still due before the month ends. */
  stillDue: { id: string; name: string; due: DateKey; amount: Paise; currency: CurrencyCode }[];
}

/** One entry on a budget page (decision 0038), at the amount it counts against the budget. */
export interface BudgetEntry {
  /** Unique per entry and category, as an entry can count in two sub-categories. */
  key: string;
  transactionId: string;
  occurredAt: string;
  /** In the home currency; positive for spending (or, on an income category, money in). */
  amount: Paise;
  /** The payee as the bank wrote it, or null when none was read. */
  payee: string | null;
  /** The shop, with every spelling of its name grouped (BUD-3). */
  place: Place;
  categoryId: string;
  /** The user's own account the money moved in, when one did. */
  account: { id: string; name: string } | null;
  note: string | null;
}

/** How many months the budget page's history shows, this one included. */
const HISTORY_MONTHS = 6;

/**
 * BUD-3: where a category's (or with null, all) spending went in a month, and
 * the entries behind it. An income category works too, with what came in
 * counted as positive. Payee spellings of one shop count as one place
 * (decision 0038), here and in the month review.
 */
export async function categoryBreakdown(month: MonthKey, categoryId: string | null, options: { page?: boolean } = {}): Promise<CategoryBreakdown> {
  // The month review needs only the totals and places; the budget page also wants accounts, 6 months and payments due.
  const page = options.page ?? false;
  const db = await getDb();
  const { ids } = await spendingTree();
  const all = flatten(await listCategories());
  const income = categoryId !== null && all.find((c) => c.id === categoryId)?.flow === 'income';
  const inTree = new Set(
    categoryId === null ? ids : all.filter((c) => c.id === categoryId || c.parentId === categoryId).map((c) => c.id),
  );
  const itemsFor = async (m: MonthKey) => {
    const { start, end } = monthBounds(m);
    const rows = db
      .select({
        transactionId: transactions.id,
        categoryId: postings.accountId,
        counterparty: transactions.counterparty,
        occurredAt: transactions.occurredAt,
        note: transactions.note,
        amount: postings.amountPaise,
        currency: postings.currency,
      })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(isNull(transactions.deletedAt), gte(transactions.occurredAt, start), lt(transactions.occurredAt, end)))
      .all()
      .filter((row) => inTree.has(row.categoryId));
    // In the home currency at each entry's day (decision 0017); unknown rates are left out.
    const converter = await homeConverter(rows);
    return rows.flatMap(({ currency, ...row }) => {
      const amount = converter.toHome(row.amount, currency, row.occurredAt);
      // Income categories are credited, so their postings are negative.
      return amount === null ? [] : [{ ...row, amount: paise(income ? -amount : amount) }];
    });
  };
  const items = await itemsFor(month);
  const placeOf = groupPlaces(items.map((i) => i.counterparty));
  // Every payee, so the screen can list all of them on request (BUD-3).
  const result = breakdown(
    items.map((i) => ({ ...i, counterparty: i.counterparty === null ? null : placeOf(i.counterparty).name })),
    { top: Number.POSITIVE_INFINITY },
  );
  const before = (page ? HISTORY_MONTHS : 4) - 1;
  const earlier = await Promise.all(
    Array.from({ length: before }, (_, i) => addMonths(month, i - before)).map(async (m) => ({ month: m, items: await itemsFor(m) })),
  );
  const history = earlier.map((h) => ({ month: h.month, total: breakdown(h.items).total }));
  const lastThree = history.slice(-3);
  const previousAverage = paise(Math.round(lastThree.reduce((sum, h) => sum + h.total, 0) / lastThree.length));

  const current = month === currentMonth();
  const today = new Date();
  const lastMonth = earlier.at(-1)!;
  const lastMonthByNow = current ? spentThrough(lastMonth.items, lastMonth.month, today.getDate()) : null;
  const running = runningTotals(items, month, current ? today.getDate() : undefined);

  // The account each entry's money moved in, from the same month's ledger rows.
  const { start, end } = monthBounds(month);
  const accountOf = new Map(
    (page ? await listTransactions({ from: start, to: end }) : [])
      .filter((row) => row.legs[0])
      .map((row) => [row.tx.id, { id: row.legs[0]!.accountId, name: row.legs[0]!.accountName }]),
  );
  const entries: BudgetEntry[] = items
    .map((i) => ({
      key: `${i.transactionId}:${i.categoryId}`,
      transactionId: i.transactionId,
      occurredAt: i.occurredAt,
      amount: i.amount,
      payee: i.counterparty ? cleanCounterparty(i.counterparty) : null,
      place: placeOf(i.counterparty),
      categoryId: i.categoryId,
      account: accountOf.get(i.transactionId) ?? null,
      note: i.note?.trim() || null,
    }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const monthEnd = dateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const home = homeCurrency();
  const stillDue = current && page
    ? (await listRecurring())
        .filter((r) => r.status === 'active' && r.categoryId !== null && inTree.has(r.categoryId) && r.nextDue >= dateKey(today) && r.nextDue <= monthEnd)
        .map((r) => ({ id: r.id, name: r.name, due: r.nextDue, amount: r.amount, currency: r.currency ?? home }))
        .sort((a, b) => a.due.localeCompare(b.due))
    : [];

  return {
    ...result,
    previousAverage,
    history: [...history, { month, total: result.total }],
    entries,
    running,
    lastMonthByNow,
    stillDue,
  };
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
    const name = line.category?.name ?? 'Your total budget';
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

