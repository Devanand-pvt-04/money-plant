import * as Crypto from 'expo-crypto';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { paise, reconcile, type AccountType, type Paise, type Reconciliation } from '@money-plant/core';
import {
  accounts,
  balanceAnchors,
  balanceRefs,
  captureLog,
  postings,
  transactions,
  type LocalAccount,
} from '@money-plant/db-schema';
import { rebaseOpening, type LedgerTransaction } from '@money-plant/matcher';
import { getDb } from './db';
import { loadTransactions, SqliteLedgerStore, writeTransaction } from './ledger-store';
import { notifyLedgerChange } from './events';

/** Accounts that hold the user's money, as opposed to category and people accounts. */
const NON_OWNED: AccountType[] = ['category', 'person'];

export interface AccountBalance {
  account: LocalAccount;
  /** Opening balance plus every posting, never a stored total. */
  balance: Paise;
  reconciliation: Reconciliation | null;
}

export async function listAccountBalances(): Promise<AccountBalance[]> {
  const db = await getDb();
  const rows = db
    .select()
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), notInArray(accounts.type, NON_OWNED)))
    .orderBy(asc(accounts.name))
    .all();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const dated = db
    .select({ accountId: postings.accountId, occurredAt: transactions.occurredAt, amount: postings.amountPaise })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(inArray(postings.accountId, ids), isNull(transactions.deletedAt)))
    .all();
  const anchors = db
    .select()
    .from(balanceAnchors)
    .where(and(inArray(balanceAnchors.accountId, ids), isNull(balanceAnchors.deletedAt)))
    .all();

  return rows.map((account) => {
    const own = dated.filter((p) => p.accountId === account.id).map((p) => ({ occurredAt: p.occurredAt, amount: paise(p.amount) }));
    const balance = own.reduce((sum, p) => sum + p.amount, account.openingBalancePaise);
    const ownAnchors = anchors
      .filter((a) => a.accountId === account.id)
      .map((a) => ({ observedAt: a.observedAt, balance: paise(a.balancePaise) }));
    return {
      account,
      balance: paise(balance),
      reconciliation: reconcile(paise(account.openingBalancePaise), own, ownAnchors),
    };
  });
}

export interface TransactionRow {
  tx: LedgerTransaction;
  /** The posting on the user's own account(s), for display. */
  legs: { accountId: string; accountName: string; amount: Paise }[];
  /** Names of every account the postings touch, including categories. */
  accountNames: Record<string, string>;
}

async function withLegs(txs: LedgerTransaction[]): Promise<TransactionRow[]> {
  const db = await getDb();
  const accountRows = db.select().from(accounts).all();
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  return txs.map((tx) => ({
    tx,
    legs: tx.postings
      .filter((p) => !NON_OWNED.includes(byId.get(p.accountId)?.type ?? 'category'))
      .map((p) => ({ accountId: p.accountId, accountName: byId.get(p.accountId)?.name ?? 'Unknown account', amount: p.amount })),
    accountNames: Object.fromEntries(tx.postings.map((p) => [p.accountId, byId.get(p.accountId)?.name ?? 'Unknown account'])),
  }));
}

export async function listTransactions(options: { accountId?: string; pendingOnly?: boolean; limit?: number } = {}) {
  const db = await getDb();
  const conditions = [isNull(transactions.deletedAt)];
  if (options.pendingOnly) conditions.push(eq(transactions.status, 'pending'));
  if (options.accountId) {
    conditions.push(
      inArray(
        transactions.id,
        db.select({ id: postings.transactionId }).from(postings).where(eq(postings.accountId, options.accountId)),
      ),
    );
  }
  const rows = db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredAt))
    .limit(options.limit ?? 500)
    .all();
  return withLegs(loadTransactions(db, rows));
}

export async function getTransaction(id: string): Promise<TransactionRow | null> {
  const db = await getDb();
  const row = db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!row) return null;
  const [result] = await withLegs(loadTransactions(db, [row]));
  return result ?? null;
}

export async function countPending(): Promise<number> {
  const db = await getDb();
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.status, 'pending')))
    .get();
  return Number(row?.n ?? 0);
}

export async function confirmTransaction(id: string): Promise<void> {
  const db = await getDb();
  db.update(transactions)
    .set({ status: 'confirmed', reviewReason: null, dirty: 1, rev: sql`${transactions.rev} + 1` })
    .where(eq(transactions.id, id))
    .run();
  notifyLedgerChange();
}

/** Soft delete. The sources stay, so re-reading the inbox never brings the entry back. */
export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDb();
  const accountIds = db.select({ id: postings.accountId }).from(postings).where(eq(postings.transactionId, id)).all();
  db.update(transactions)
    .set({ deletedAt: new Date().toISOString(), dirty: 1, rev: sql`${transactions.rev} + 1` })
    .where(eq(transactions.id, id))
    .run();
  const store = new SqliteLedgerStore(db);
  for (const { id: accountId } of accountIds) await rebaseOpening(store, accountId);
  notifyLedgerChange();
}

/**
 * Undoes a transfer match: the debit and the credit become two separate
 * entries again, each with the sources that reported it.
 */
export async function splitTransfer(id: string): Promise<void> {
  const db = await getDb();
  const [tx] = loadTransactions(db, db.select().from(transactions).where(eq(transactions.id, id)).all());
  if (!tx || tx.kind !== 'transfer' || tx.postings.length !== 2) throw new Error('Not a transfer');
  const debit = tx.postings.find((p) => p.amount < 0)!;
  const credit = tx.postings.find((p) => p.amount > 0)!;
  const debitSources = tx.sources.filter((s) => s.parsedFields.direction === 'debit');
  const creditSources = tx.sources.filter((s) => s.parsedFields.direction !== 'debit');
  if (debitSources.length === 0 || creditSources.length === 0) throw new Error('Each side needs its own message');

  const store = new SqliteLedgerStore(db);
  const spending = await store.systemAccount('uncategorised_expense');
  const income = await store.systemAccount('uncategorised_income');
  const newId = () => Crypto.randomUUID();
  writeTransaction(db, {
    ...tx,
    occurredAt: debitSources[0]!.receivedAt,
    kind: 'expense',
    status: 'confirmed',
    reviewReason: null,
    postings: [debit, { id: newId(), accountId: spending.id, amount: paise(-debit.amount) }],
    sources: debitSources,
  });
  writeTransaction(db, {
    ...tx,
    id: newId(),
    occurredAt: creditSources[0]!.receivedAt,
    kind: 'income',
    status: 'confirmed',
    reviewReason: null,
    // A fresh posting id: the server keeps posting ids bound to their original transaction.
    postings: [{ ...credit, id: newId() }, { id: newId(), accountId: income.id, amount: paise(-credit.amount) }],
    sources: creditSources,
  });
  notifyLedgerChange();
}

/** The user says what the balance is now. Earlier entries keep their effect on history only. */
export async function setCurrentBalance(accountId: string, balance: Paise): Promise<void> {
  const store = await SqliteLedgerStore.open();
  await store.setBalanceRef(accountId, { kind: 'user', balance, at: new Date().toISOString() });
  await rebaseOpening(store, accountId);
  notifyLedgerChange();
}

/** One-tap fix for a reconciliation gap: trust the latest balance the bank reported. */
export async function adoptBankBalance(accountId: string): Promise<void> {
  const db = await getDb();
  const latest = db
    .select()
    .from(balanceAnchors)
    .where(and(eq(balanceAnchors.accountId, accountId), isNull(balanceAnchors.deletedAt)))
    .orderBy(desc(balanceAnchors.observedAt))
    .get();
  if (!latest) return;
  const store = new SqliteLedgerStore(db);
  await store.setBalanceRef(accountId, { kind: 'user', balance: paise(latest.balancePaise), at: latest.observedAt });
  await rebaseOpening(store, accountId);
  notifyLedgerChange();
}

/**
 * Accounts added by hand (or synced from another phone) before any entry
 * reached them: their opening balance is "the balance when created", so older
 * imported SMS must not shift it.
 */
export async function ensureBalanceRefs(): Promise<void> {
  const db = await getDb();
  const missing = db
    .select()
    .from(accounts)
    .where(
      and(
        isNull(accounts.deletedAt),
        notInArray(accounts.type, NON_OWNED),
        notInArray(accounts.id, db.select({ id: balanceRefs.accountId }).from(balanceRefs)),
        notInArray(accounts.id, db.select({ id: postings.accountId }).from(postings)),
      ),
    )
    .all();
  const store = new SqliteLedgerStore(db);
  for (const account of missing) {
    await store.setBalanceRef(account.id, { kind: 'user', balance: paise(account.openingBalancePaise), at: account.createdAt });
  }
}

export interface SenderStats {
  sender: string;
  parsed: number;
  ignored: number;
  failed: number;
}

/** CAP-8: how well each bank's messages are read. */
export async function captureStats(): Promise<{ senders: SenderStats[]; failures: { fingerprint: string; sender: string; receivedAt: string; rawText: string | null; reason: string | null }[] }> {
  const db = await getDb();
  const senders = db
    .select({
      sender: captureLog.sender,
      parsed: sql<number>`sum(case when ${captureLog.status} = 'parsed' then 1 else 0 end)`,
      ignored: sql<number>`sum(case when ${captureLog.status} = 'ignored' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${captureLog.status} = 'failed' then 1 else 0 end)`,
    })
    .from(captureLog)
    .groupBy(captureLog.sender)
    .orderBy(asc(captureLog.sender))
    .all()
    .map((row) => ({ sender: row.sender, parsed: Number(row.parsed), ignored: Number(row.ignored), failed: Number(row.failed) }));
  const failures = db
    .select({ fingerprint: captureLog.fingerprint, sender: captureLog.sender, receivedAt: captureLog.receivedAt, rawText: captureLog.rawText, reason: captureLog.reason })
    .from(captureLog)
    .where(eq(captureLog.status, 'failed'))
    .orderBy(desc(captureLog.receivedAt))
    .limit(50)
    .all();
  return { senders, failures };
}
