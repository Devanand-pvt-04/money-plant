import * as Crypto from 'expo-crypto';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { addDays, dateKey, daysBetween, nextOccurrence, paise, startOfDate, type DateKey, type Paise } from '@money-plant/core';
import { accounts, recurring, transactions, type LocalRecurring } from '@money-plant/db-schema';
import {
  applyPreDebit,
  debitOf,
  detectRecurring,
  digitsMatch,
  dueState,
  institutionBank,
  settleRecurring,
  shortfall,
  type Debit,
  type RecurringPayment,
} from '@money-plant/matcher';
import { normaliseMerchant } from '@money-plant/categoriser';
import type { ParsedPreDebit } from '@money-plant/parser';
import { formatAmount } from '@/components/format';
import { ownedAccountIds } from './categories';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { listAccountBalances, type AccountBalance } from './ledger';
import { loadTransactions } from './ledger-store';
import { cancelScheduled, notifyAt, requestNotificationPermission } from './notifications';

/** How far back detection and matching look: the 6-month import plus a margin. */
const HISTORY_DAYS = 200;
const REMINDER_PREFIX = 'rec:';
/** Reminders go out at 9 am, 3 days and 1 day before the due date (REC-3). */
const REMINDER_DAYS = [3, 1] as const;
const REMINDER_HOUR = 9;

export const today = (): DateKey => dateKey(new Date());

function toPayment(row: LocalRecurring): RecurringPayment {
  return {
    id: row.id,
    name: row.name,
    vpa: row.vpa,
    merchant: row.merchant,
    amount: paise(row.amountPaise),
    cadence: row.cadence,
    anchorDay: row.anchorDay,
    nextDue: row.nextDue,
    accountId: row.accountId,
    categoryId: row.categoryAccountId,
    status: row.status,
    origin: row.origin,
    mandateRef: row.mandateRef,
    lastPaidAt: row.lastPaidAt,
    lastTransactionId: row.lastTransactionId,
  };
}

function toRow(item: RecurringPayment) {
  return {
    name: item.name,
    vpa: item.vpa,
    merchant: item.merchant,
    amountPaise: item.amount,
    cadence: item.cadence,
    anchorDay: item.anchorDay,
    nextDue: item.nextDue,
    accountId: item.accountId,
    categoryAccountId: item.categoryId,
    status: item.status,
    origin: item.origin,
    mandateRef: item.mandateRef,
    lastPaidAt: item.lastPaidAt,
    lastTransactionId: item.lastTransactionId,
  };
}

export async function listRecurring(): Promise<RecurringPayment[]> {
  const db = await getDb();
  return db.select().from(recurring).where(isNull(recurring.deletedAt)).all().map(toPayment);
}

export async function getRecurring(id: string): Promise<RecurringPayment | null> {
  const db = await getDb();
  const row = db.select().from(recurring).where(eq(recurring.id, id)).get();
  return row && row.deletedAt === null ? toPayment(row) : null;
}

/** Writes a recurring payment and marks it for sync. A new one gets an id. */
async function write(item: RecurringPayment | Omit<RecurringPayment, 'id'>): Promise<string> {
  const db = await getDb();
  const id = 'id' in item ? item.id : Crypto.randomUUID();
  const values = toRow({ ...item, id });
  db.insert(recurring)
    .values({ id, ...values, createdAt: new Date().toISOString(), dirty: 1 })
    .onConflictDoUpdate({ target: recurring.id, set: { ...values, dirty: 1, rev: sql`${recurring.rev} + 1` } })
    .run();
  return id;
}

export interface RecurringInput {
  name: string;
  amount: Paise;
  cadence: RecurringPayment['cadence'];
  nextDue: DateKey;
  accountId: string | null;
  categoryId: string | null;
  /** A UPI ID or a merchant name, as the user typed it; debits to it count as this payment. */
  payee: string | null;
}

function payeeFields(payee: string | null): Pick<RecurringPayment, 'vpa' | 'merchant'> {
  const text = payee?.trim() ?? '';
  if (!text) return { vpa: null, merchant: null };
  return text.includes('@') ? { vpa: text.toLowerCase(), merchant: null } : { vpa: null, merchant: normaliseMerchant(text) };
}

/** REC-2: the user adds or edits a recurring payment. */
export async function saveRecurring(id: string | null, input: RecurringInput): Promise<string> {
  if (!input.name.trim()) throw new Error('Give it a name');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter an amount above zero');
  const existing = id ? await getRecurring(id) : null;
  const payee = payeeFields(input.payee ?? input.name);
  const anchorDay = input.cadence === 'weekly' ? null : Number(input.nextDue.slice(8));
  const savedId = await write({
    ...(existing ?? { status: 'active' as const, origin: 'manual' as const, mandateRef: null, lastPaidAt: null, lastTransactionId: null }),
    ...(existing ? { id: existing.id } : {}),
    name: input.name.trim(),
    amount: input.amount,
    cadence: input.cadence,
    anchorDay,
    nextDue: input.nextDue,
    accountId: input.accountId,
    categoryId: input.categoryId,
    ...payee,
  });
  await requestNotificationPermission().catch(() => false);
  await refreshRecurring();
  return savedId;
}

export async function setRecurringStatus(id: string, status: RecurringPayment['status']): Promise<void> {
  const item = await getRecurring(id);
  if (!item) return;
  let nextDue = item.nextDue;
  // A payment resumed after a pause, or accepted late, starts from its next date still ahead.
  if (status === 'active') {
    while (dueState({ nextDue }, today()).overdue) nextDue = nextOccurrence(nextDue, item.cadence, item.anchorDay);
  }
  await write({ ...item, status, nextDue });
  if (status === 'active') await requestNotificationPermission().catch(() => false);
  await refreshRecurring();
}

export async function deleteRecurring(id: string): Promise<void> {
  const db = await getDb();
  db.update(recurring)
    .set({ deletedAt: new Date().toISOString(), dirty: 1, rev: sql`${recurring.rev} + 1` })
    .where(eq(recurring.id, id))
    .run();
  await refreshRecurring();
}

/**
 * The user says this occurrence is done: paid some way the app didn't see
 * (`paid`), or not happening this time (skipped). Either way the due date moves on.
 */
export async function closeOccurrence(id: string, how: 'paid' | 'skipped'): Promise<void> {
  const item = await getRecurring(id);
  if (!item) return;
  await write({
    ...item,
    nextDue: nextOccurrence(item.nextDue, item.cadence, item.anchorDay),
    ...(how === 'paid' ? { lastPaidAt: new Date().toISOString(), lastTransactionId: null } : {}),
  });
  await refreshRecurring();
}

/** Spending entries from the last HISTORY_DAYS, as debits. */
async function recentDebits(): Promise<Debit[]> {
  const db = await getDb();
  const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.kind, 'expense'), gte(transactions.occurredAt, from)))
    .all();
  const owned = ownedAccountIds(db);
  return loadTransactions(db, rows)
    .map((tx) => debitOf(tx, (accountId) => owned.has(accountId)))
    .filter((d): d is Debit => d !== null);
}

/** A debit's category, unless it is one of the "uncategorised" fallbacks. */
async function realCategories(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = await getDb();
  return new Set(
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(inArray(accounts.id, [...ids]), sql`${accounts.categoryKey} is not null`))
      .all()
      .map((row) => row.id),
  );
}

let refreshing: Promise<number> | null = null;

/**
 * REC-1 and REC-4: marks occurrences paid from new debits, proposes newly
 * detected recurring payments, then reschedules reminders. Safe to run often;
 * concurrent calls share one run. Returns how many rows changed.
 */
export function refreshRecurring(): Promise<number> {
  refreshing ??= (async () => {
    try {
      const debits = await recentDebits();
      const items = await listRecurring();
      let changed = 0;
      for (const item of items) {
        const { item: settled, paid } = settleRecurring(item, debits);
        if (paid.length === 0) continue;
        await write(settled);
        changed++;
      }
      const all = await listRecurring();
      const proposals = detectRecurring(debits, all, today());
      const categories = await realCategories(proposals.map((p) => p.categoryId).filter((id): id is string => id !== null));
      for (const proposal of proposals) {
        await write({
          ...proposal,
          categoryId: proposal.categoryId && categories.has(proposal.categoryId) ? proposal.categoryId : null,
          status: 'proposed',
          origin: 'history',
          mandateRef: null,
        });
        changed++;
      }
      await scheduleReminders();
      if (changed > 0) notifyLedgerChange();
      return changed;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** REC-1: a pre-debit SMS updates or starts a recurring payment. Only the parsed fields arrive here. */
export async function applyPreDebitNotice(notice: ParsedPreDebit): Promise<void> {
  const db = await getDb();
  const own = db
    .select()
    .from(accounts)
    .where(isNull(accounts.deletedAt))
    .all()
    .filter((a) => institutionBank(a.institution) === notice.bank && a.last4 !== null && notice.accountLast !== null && digitsMatch(a.last4, notice.accountLast));
  const card = notice.instrument === 'credit_card' || notice.instrument === 'card';
  const account = own.find((a) => (card ? a.type === 'credit_card' : a.type === 'bank')) ?? own[0];
  const result = applyPreDebit(await listRecurring(), notice, account?.id ?? null);
  if (!result) return;
  await write('update' in result ? result.update : result.create);
  await refreshRecurring();
  notifyLedgerChange();
}

export interface UpcomingPayment {
  item: RecurringPayment;
  /** Days until due; negative once the due date has passed. */
  days: number;
  overdue: boolean;
  accountName: string | null;
  /** REC-3: how much the paying account looks short by, when it does. */
  short: Paise | null;
}

function upcomingOf(items: readonly RecurringPayment[], balances: readonly AccountBalance[], on: DateKey): UpcomingPayment[] {
  const byId = new Map(balances.map((b) => [b.account.id, b]));
  return items
    .filter((item) => item.status === 'active')
    .map((item) => {
      const account = item.accountId ? byId.get(item.accountId) : undefined;
      return {
        item,
        ...dueState(item, on),
        accountName: account?.account.name ?? null,
        short: shortfall(item, items, account && { balance: account.balance, liability: account.liability }),
      };
    })
    .sort((a, b) => a.days - b.days);
}

/** HOME-1: active payments due within `withinDays`, overdue ones first. */
export async function upcomingPayments(withinDays = 7): Promise<UpcomingPayment[]> {
  const [items, balances] = await Promise.all([listRecurring(), listAccountBalances()]);
  return upcomingOf(items, balances, today()).filter((u) => u.days <= withinDays);
}

export async function recurringOverview(): Promise<{ upcoming: UpcomingPayment[]; proposed: RecurringPayment[]; paused: RecurringPayment[] }> {
  const [items, balances] = await Promise.all([listRecurring(), listAccountBalances()]);
  return {
    upcoming: upcomingOf(items, balances, today()),
    proposed: items.filter((item) => item.status === 'proposed'),
    paused: items.filter((item) => item.status === 'paused'),
  };
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago". */
export function dueLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

/**
 * REC-3: local reminders 3 days and 1 day before each active payment, with a
 * warning when the paying account looks short. Rebuilt from scratch each time,
 * so edits, payments and new balances are always reflected.
 */
export async function scheduleReminders(): Promise<void> {
  const [items, balances] = await Promise.all([listRecurring(), listAccountBalances()]);
  await cancelScheduled(REMINDER_PREFIX);
  const on = today();
  for (const upcoming of upcomingOf(items, balances, on)) {
    const { item, short, accountName } = upcoming;
    for (const before of REMINDER_DAYS) {
      const day = addDays(item.nextDue, -before);
      if (daysBetween(on, day) < 0) continue;
      const at = startOfDate(day);
      at.setHours(REMINDER_HOUR);
      const when = before === 1 ? 'tomorrow' : `in ${before} days`;
      await notifyAt({
        id: `${REMINDER_PREFIX}${item.id}:${before}`,
        channel: 'reminders',
        at,
        title: `${item.name}: ${formatAmount(item.amount)} due ${when}`,
        body: short
          ? `${accountName} may be short by ${formatAmount(short)}. Top it up before then.`
          : accountName
            ? `It will be paid from ${accountName}.`
            : 'Tap to see it in Money Plant.',
        data: { url: `/recurring/${item.id}` },
      });
    }
  }
}
