import * as Crypto from 'expo-crypto';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  addDays,
  dateKey,
  dateOf,
  interestOn,
  isDepositPayment,
  isMaturityCredit,
  maturityValue,
  paidIn,
  paise,
  startOfDate,
  type DateKey,
  type DepositKind,
  type DepositPayout,
  type DepositTerms,
  type Paise,
} from '@money-plant/core';
import { accounts, balanceRefs, deposits, postings, transactions, type LocalDeposit } from '@money-plant/db-schema';
import type { LedgerTransaction } from '@money-plant/matcher';
import { formatWholeRupees } from '@/components/format';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { derivedId } from './ids';
import { loadTransactions, systemAccountId, writeTransaction } from './ledger-store';
import { cancelScheduled, notifyAt } from './notifications';

const now = () => new Date().toISOString();
const today = () => dateKey(new Date());

export const REMINDER_PREFIX = 'deposit:';
export const MATURITY_REMINDER_DAYS = 7;
const REMINDER_HOUR = 9;

export function termsOf(row: LocalDeposit): DepositTerms {
  return {
    kind: row.kind,
    amount: paise(row.amountPaise),
    rateBp: row.rateBp,
    startDate: row.startDate,
    maturityDate: row.maturityDate,
    payout: row.payout,
  };
}

/** Open and closed deposits whose account still exists. */
export async function listDeposits(): Promise<LocalDeposit[]> {
  const db = await getDb();
  return db
    .select({ deposit: deposits })
    .from(deposits)
    .innerJoin(accounts, eq(accounts.id, deposits.accountId))
    .where(and(isNull(deposits.deletedAt), isNull(accounts.deletedAt)))
    .all()
    .map((row) => row.deposit);
}

export async function getDeposit(accountId: string): Promise<LocalDeposit | null> {
  return (await listDeposits()).find((d) => d.accountId === accountId) ?? null;
}

export interface DepositValue {
  value: Paise;
  interest: Paise;
  maturity: Paise;
}

/** NW-1: a deposit's value today, interest so far included. A closed deposit is worth nothing more. */
export function depositValue(row: LocalDeposit, on: DateKey = today()): DepositValue {
  const terms = termsOf(row);
  if (row.closedAt) return { value: paise(0), interest: paise(0), maturity: maturityValue(terms) };
  return { value: paise(paidIn(terms, on) + interestOn(terms, on)), interest: interestOn(terms, on), maturity: maturityValue(terms) };
}

export interface DepositInput {
  accountId: string;
  kind: DepositKind;
  amount: Paise;
  rateBp: number;
  startDate: DateKey;
  maturityDate: DateKey;
  payout: DepositPayout;
  paidFromAccountId: string | null;
  payee: string | null;
}

/**
 * NW-2: saves a deposit's terms (one row per account, with an id both phones
 * derive alike), then matches its payments and reminders straight away.
 */
export async function saveDeposit(input: DepositInput): Promise<void> {
  const db = await getDb();
  const id = await derivedId(`deposit:${input.accountId}`);
  const values = {
    accountId: input.accountId,
    kind: input.kind,
    amountPaise: input.amount,
    rateBp: input.rateBp,
    startDate: input.startDate,
    maturityDate: input.maturityDate,
    payout: input.kind === 'rd' ? ('reinvest' as const) : input.payout,
    paidFromAccountId: input.paidFromAccountId,
    payee: input.payee?.trim() || null,
    deletedAt: null,
    dirty: 1,
  };
  db.insert(deposits)
    .values({ id, ...values, createdAt: now() })
    .onConflictDoUpdate({ target: deposits.id, set: { ...values, rev: sql`${deposits.rev} + 1` } })
    .run();
  await refreshDeposits();
  notifyLedgerChange();
}

/** The income category deposit interest lands on: Interest, else Other income, else Uncategorised income. */
async function interestCategory(): Promise<string> {
  const db = await getDb();
  const rows = db
    .select({ id: accounts.id, key: accounts.categoryKey })
    .from(accounts)
    .where(and(eq(accounts.type, 'category'), isNull(accounts.deletedAt), inArray(accounts.categoryKey, ['income.interest', 'income.other'])))
    .all();
  return rows.find((r) => r.key === 'income.interest')?.id ?? rows[0]?.id ?? (await systemAccountId('uncategorised_income'));
}

/**
 * NW-2: keeps every open deposit in step with the ledger.
 * - Debits that paid into it (RD instalments, the FD's opening payment)
 *   become transfers into the deposit, so they stop counting as spending.
 * - Its balance is what should have gone in by today, so instalments paid
 *   before the SMS history began still count.
 * - The credit that pays it back at maturity becomes a transfer out of it,
 *   with the interest posted as income, and the deposit closes.
 * - A reminder goes out 7 days before it matures.
 * Entries whose kind the user set by hand are left alone. Returns the
 * number of entries changed.
 */
export async function refreshDeposits(): Promise<number> {
  const db = await getDb();
  const open = (await listDeposits()).filter((d) => !d.closedAt);
  const owned = new Set(
    db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
      .all()
      .filter((a) => a.type !== 'category' && a.type !== 'person')
      .map((a) => a.id),
  );
  const on = today();
  let changed = 0;

  for (const row of open) {
    const terms = termsOf(row);
    const from = startOfDate(addDays(terms.startDate, -3)).toISOString();
    const until = startOfDate(addDays(terms.maturityDate, 11)).toISOString();
    const candidates = loadTransactions(
      db,
      db
        .select()
        .from(transactions)
        .where(and(isNull(transactions.deletedAt), inArray(transactions.kind, ['expense', 'income']), gte(transactions.occurredAt, from), lt(transactions.occurredAt, until)))
        .all(),
    ).filter((tx) => !tx.userSetFields.includes('kind'));
    const ownLeg = (tx: LedgerTransaction) => {
      const legs = tx.postings.filter((p) => owned.has(p.accountId) && p.accountId !== row.accountId);
      return legs.length === 1 && tx.postings.length === 2 ? legs[0]! : null;
    };
    const fromPayer = (accountId: string) => row.paidFromAccountId === null || accountId === row.paidFromAccountId;

    for (const tx of candidates) {
      const leg = ownLeg(tx);
      if (!leg || tx.kind !== 'expense' || leg.amount >= 0 || !fromPayer(leg.accountId)) continue;
      if (!isDepositPayment(terms, row.payee, { amount: paise(-leg.amount), on: dateOf(tx.occurredAt), counterparty: tx.counterparty })) continue;
      writeTransaction(db, {
        ...tx,
        kind: 'transfer',
        status: 'confirmed',
        reviewReason: null,
        categoryReason: null,
        categoryRuleId: null,
        postings: [leg, { id: Crypto.randomUUID(), accountId: row.accountId, amount: paise(-leg.amount) }],
      });
      changed++;
    }

    // Before a payout closes it, so every instalment is in and the balance ends at zero.
    await keepScheduledBalance(row, terms, on);

    if (on >= addDays(terms.maturityDate, -3)) {
      const credit = candidates.find((tx) => {
        const leg = ownLeg(tx);
        return tx.kind === 'income' && leg && leg.amount > 0 && fromPayer(leg.accountId) && isMaturityCredit(terms, { amount: leg.amount, on: dateOf(tx.occurredAt), counterparty: tx.counterparty });
      });
      if (credit) {
        const leg = ownLeg(credit)!;
        const principal = paidIn(terms, terms.maturityDate);
        writeTransaction(db, {
          ...credit,
          kind: 'transfer',
          status: 'confirmed',
          reviewReason: null,
          categoryReason: null,
          categoryRuleId: null,
          postings: [
            leg,
            { id: Crypto.randomUUID(), accountId: row.accountId, amount: paise(-principal) },
            { id: Crypto.randomUUID(), accountId: await interestCategory(), amount: paise(principal - leg.amount) },
          ],
        });
        db.update(deposits).set({ closedAt: now(), dirty: 1, rev: sql`${deposits.rev} + 1` }).where(eq(deposits.id, row.id)).run();
        changed++;
      }
    }
  }

  await scheduleMaturityReminders();
  if (changed > 0) notifyLedgerChange();
  return changed;
}

/** The deposit's balance is what the schedule says went in by today; the opening balance absorbs the difference. */
async function keepScheduledBalance(row: LocalDeposit, terms: DepositTerms, on: DateKey): Promise<void> {
  const db = await getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, row.accountId)).get();
  if (!account) return;
  const posted = db
    .select({ total: sql<number>`coalesce(sum(${postings.amountPaise}), 0)` })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(eq(postings.accountId, row.accountId), isNull(transactions.deletedAt)))
    .get();
  const balance = paidIn(terms, on);
  const opening = balance - Number(posted?.total ?? 0);
  if (opening === account.openingBalancePaise) return;
  db.transaction((t) => {
    t.update(accounts).set({ openingBalancePaise: opening, dirty: 1, rev: sql`${accounts.rev} + 1` }).where(eq(accounts.id, row.accountId)).run();
    // The balance the user would otherwise have typed, so a later rebase keeps it.
    t.insert(balanceRefs)
      .values({ accountId: row.accountId, kind: 'user', balancePaise: balance, at: now() })
      .onConflictDoUpdate({ target: balanceRefs.accountId, set: { kind: 'user', balancePaise: balance, at: now() } })
      .run();
  });
}

/** A notification at 9 am, 7 days before each open deposit matures. */
async function scheduleMaturityReminders(): Promise<void> {
  const db = await getDb();
  await cancelScheduled(REMINDER_PREFIX);
  const names = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
  for (const row of await listDeposits()) {
    if (row.closedAt) continue;
    const at = startOfDate(addDays(row.maturityDate, -MATURITY_REMINDER_DAYS));
    at.setHours(REMINDER_HOUR);
    const name = names.get(row.accountId) ?? (row.kind === 'fd' ? 'Your FD' : 'Your RD');
    const payer = row.paidFromAccountId ? names.get(row.paidFromAccountId) : undefined;
    await notifyAt({
      id: `${REMINDER_PREFIX}${row.id}`,
      channel: 'reminders',
      at,
      title: `${name} matures in ${MATURITY_REMINDER_DAYS} days`,
      body: `It should pay about ${formatWholeRupees(maturityValue(termsOf(row)))}${payer ? ` into ${payer}` : ''}.`,
      data: { url: `/account/${row.accountId}` },
    });
  }
}

/**
 * The payee most often seen on debits of exactly `amount`, to fill in an RD's
 * payee from its instalments (for example SHIVALIK SMALL).
 */
export async function suggestPayee(amount: Paise): Promise<string | null> {
  const db = await getDb();
  const rows = db
    .select({ counterparty: transactions.counterparty, count: sql<number>`count(*)` })
    .from(transactions)
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .where(and(isNull(transactions.deletedAt), eq(postings.amountPaise, -amount), sql`${transactions.counterparty} is not null`))
    .groupBy(transactions.counterparty)
    .orderBy(sql`count(*) desc`)
    .limit(1)
    .all();
  return rows[0]?.counterparty ?? null;
}
