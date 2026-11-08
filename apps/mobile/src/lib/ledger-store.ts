import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { ANY_CURRENCY_TYPES, DEFAULT_CURRENCY, paise, type Paise } from '@money-plant/core';
import {
  accounts,
  balanceAnchors,
  balanceRefs,
  pendingNotifications,
  postings,
  sources,
  transactions,
} from '@money-plant/db-schema';
import {
  SYSTEM_ACCOUNT_NAMES,
  checkTransaction,
  type BalanceAnchor,
  type BalanceRef,
  type LedgerAccount,
  type LedgerSource,
  type LedgerStore,
  type LedgerTransaction,
  type PendingNotification,
  type ReviewReason,
  type SourceKind,
  type SystemAccountKey,
  type UserSetField,
} from '@money-plant/matcher';
import type { CategoryReason } from '@money-plant/categoriser';
import { getDb, type Database } from './db';
import { derivedId } from './ids';

const now = () => new Date().toISOString();

/** Category accounts the pipeline falls back to have an id derived from the user id, like the default categories. */
export function systemAccountId(key: SystemAccountKey): Promise<string> {
  return derivedId(`system:${key}`);
}

function toLedgerAccount(row: typeof accounts.$inferSelect): LedgerAccount {
  return { id: row.id, type: row.type, name: row.name, institution: row.institution, last4: row.last4 };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Reads full transactions (postings and sources) for a set of rows. */
export function loadTransactions(db: Database, rows: (typeof transactions.$inferSelect)[]): LedgerTransaction[] {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const postingRows = db.select().from(postings).where(inArray(postings.transactionId, ids)).all();
  const sourceRows = db.select().from(sources).where(inArray(sources.transactionId, ids)).all();
  // Grouped once, so loading n entries stays linear instead of scanning every posting per entry.
  const postingsOf = groupBy(postingRows, (p) => p.transactionId);
  const sourcesOf = groupBy(sourceRows, (s) => s.transactionId);
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt,
    counterparty: row.counterparty,
    kind: row.kind,
    status: row.status,
    confidence: row.confidence,
    reviewReason: row.reviewReason as ReviewReason | null,
    categoryReason: row.categoryReason as CategoryReason | null,
    categoryRuleId: row.categoryRuleId,
    userSetFields: JSON.parse(row.userSetFields) as UserSetField[],
    note: row.note,
    splitGroupId: row.splitGroupId,
    postings: (postingsOf.get(row.id) ?? []).map((p) => ({ id: p.id, accountId: p.accountId, amount: paise(p.amountPaise), currency: p.currency })),
    sources: (sourcesOf.get(row.id) ?? []).map(
      (s): LedgerSource => ({
        id: s.id,
        kind: s.kind as SourceKind,
        sender: s.sender,
        externalRef: s.externalRef,
        fingerprint: s.fingerprint,
        parsedFields: JSON.parse(s.parsedFields) as Record<string, unknown>,
        receivedAt: s.receivedAt,
        confidence: s.confidence,
        rawText: s.rawText,
      }),
    ),
  }));
}

/**
 * Postings made without a currency (SMS capture, statements, rules) take the
 * currency of the user's own account in the entry, so an entry on a dollar
 * account is in dollars throughout (decision 0017). Postings that name a
 * currency keep it.
 */
function withCurrencies(db: Database, tx: LedgerTransaction): LedgerTransaction {
  if (tx.postings.every((p) => p.currency)) return tx;
  const rows = db
    .select({ id: accounts.id, type: accounts.type, currency: accounts.currency })
    .from(accounts)
    .where(inArray(accounts.id, [...new Set(tx.postings.map((p) => p.accountId))]))
    .all();
  const ownCurrency = new Map(rows.filter((a) => !ANY_CURRENCY_TYPES.has(a.type)).map((a) => [a.id, a.currency]));
  const own = tx.postings.find((p) => ownCurrency.has(p.accountId));
  const fallback = own ? (own.currency ?? ownCurrency.get(own.accountId)!) : DEFAULT_CURRENCY;
  return { ...tx, postings: tx.postings.map((p) => (p.currency ? p : { ...p, currency: ownCurrency.get(p.accountId) ?? fallback })) };
}

/** Writes a transaction with exactly these postings and sources, and marks it for sync. */
export function writeTransaction(db: Database, written: LedgerTransaction): void {
  const tx = withCurrencies(db, written);
  const problem = checkTransaction(tx);
  if (problem) throw new Error(`Refusing to save transaction ${tx.id}: ${problem}`);
  const createdAt = now();
  db.transaction((t) => {
    t.insert(transactions)
      .values({
        id: tx.id,
        occurredAt: tx.occurredAt,
        counterparty: tx.counterparty,
        kind: tx.kind,
        status: tx.status,
        confidence: tx.confidence,
        reviewReason: tx.reviewReason,
        categoryReason: tx.categoryReason,
        categoryRuleId: tx.categoryRuleId,
        userSetFields: JSON.stringify(tx.userSetFields),
        note: tx.note,
        splitGroupId: tx.splitGroupId ?? null,
        createdAt,
        dirty: 1,
      })
      .onConflictDoUpdate({
        target: transactions.id,
        set: {
          occurredAt: tx.occurredAt,
          counterparty: tx.counterparty,
          kind: tx.kind,
          status: tx.status,
          confidence: tx.confidence,
          reviewReason: tx.reviewReason,
          categoryReason: tx.categoryReason,
          categoryRuleId: tx.categoryRuleId,
          userSetFields: JSON.stringify(tx.userSetFields),
          note: tx.note,
          ...(tx.splitGroupId !== undefined ? { splitGroupId: tx.splitGroupId } : {}),
          dirty: 1,
          rev: sql`${transactions.rev} + 1`,
        },
      })
      .run();
    t.delete(postings).where(eq(postings.transactionId, tx.id)).run();
    t.insert(postings)
      .values(
        tx.postings.map((p) => ({ id: p.id, transactionId: tx.id, accountId: p.accountId, amountPaise: p.amount, currency: p.currency ?? DEFAULT_CURRENCY, createdAt })),
      )
      .run();
    for (const s of tx.sources) {
      const values = {
        transactionId: tx.id,
        kind: s.kind,
        sender: s.sender,
        externalRef: s.externalRef,
        fingerprint: s.fingerprint,
        parsedFields: JSON.stringify(s.parsedFields),
        receivedAt: s.receivedAt,
        confidence: s.confidence,
      };
      t.insert(sources)
        .values({ id: s.id, ...values, rawText: s.rawText, createdAt })
        .onConflictDoUpdate({ target: sources.id, set: values })
        .run();
    }
  });
}

/** The capture pipeline's storage, on the phone's encrypted SQLite database. */
export class SqliteLedgerStore implements LedgerStore {
  constructor(private readonly db: Database) {}

  static async open(): Promise<SqliteLedgerStore> {
    return new SqliteLedgerStore(await getDb());
  }

  async listAccounts() {
    return this.db.select().from(accounts).where(isNull(accounts.deletedAt)).all().map(toLedgerAccount);
  }

  async createAccount(account: LedgerAccount) {
    this.db
      .insert(accounts)
      .values({ ...account, openingBalancePaise: 0, createdAt: now(), dirty: 1 })
      .run();
  }

  async setAccountLast4(accountId: string, last4: string) {
    this.db
      .update(accounts)
      .set({ last4, dirty: 1, rev: sql`${accounts.rev} + 1` })
      .where(eq(accounts.id, accountId))
      .run();
  }

  async systemAccount(key: SystemAccountKey) {
    const id = await systemAccountId(key);
    const existing = this.db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (existing) return toLedgerAccount(existing);
    const account: LedgerAccount = { id, type: 'category', name: SYSTEM_ACCOUNT_NAMES[key], institution: null, last4: null };
    await this.createAccount(account);
    return account;
  }

  async hasFingerprint(fingerprint: string) {
    const source = this.db.select({ id: sources.id }).from(sources).where(eq(sources.fingerprint, fingerprint)).get();
    if (source) return true;
    const held = this.db
      .select({ id: pendingNotifications.id })
      .from(pendingNotifications)
      .where(sql`json_extract(${pendingNotifications.payload}, '$.source.fingerprint') = ${fingerprint}`)
      .get();
    return held !== undefined;
  }

  async transactionsBetween(fromIso: string, toIso: string) {
    const rows = this.db
      .select()
      .from(transactions)
      .where(and(isNull(transactions.deletedAt), gte(transactions.occurredAt, fromIso), lte(transactions.occurredAt, toIso)))
      .all();
    return loadTransactions(this.db, rows);
  }

  async saveTransaction(transaction: LedgerTransaction) {
    writeTransaction(this.db, transaction);
  }

  async addAnchor(anchor: BalanceAnchor) {
    this.db
      .insert(balanceAnchors)
      .values({
        id: anchor.id,
        accountId: anchor.accountId,
        balancePaise: anchor.balance,
        observedAt: anchor.observedAt,
        sourceId: anchor.sourceId,
        createdAt: now(),
        dirty: 1,
      })
      .run();
  }

  async getBalanceRef(accountId: string): Promise<BalanceRef | null> {
    const row = this.db.select().from(balanceRefs).where(eq(balanceRefs.accountId, accountId)).get();
    return row ? { kind: row.kind, balance: paise(row.balancePaise), at: row.at } : null;
  }

  async setBalanceRef(accountId: string, ref: BalanceRef) {
    const values = { kind: ref.kind, balancePaise: ref.balance, at: ref.at };
    this.db
      .insert(balanceRefs)
      .values({ accountId, ...values })
      .onConflictDoUpdate({ target: balanceRefs.accountId, set: values })
      .run();
  }

  async sumPostings(accountId: string, upToIso: string): Promise<Paise> {
    const row = this.db
      .select({ total: sql<number>`coalesce(sum(${postings.amountPaise}), 0)` })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(eq(postings.accountId, accountId), isNull(transactions.deletedAt), lte(transactions.occurredAt, upToIso)))
      .get();
    return paise(Number(row?.total ?? 0));
  }

  async setOpeningBalance(accountId: string, opening: Paise) {
    this.db
      .update(accounts)
      .set({ openingBalancePaise: opening, dirty: 1, rev: sql`${accounts.rev} + 1` })
      .where(and(eq(accounts.id, accountId), sql`${accounts.openingBalancePaise} <> ${opening}`))
      .run();
  }

  async pendingNotifications(fromIso: string, toIso: string) {
    return this.db
      .select()
      .from(pendingNotifications)
      .where(and(gte(pendingNotifications.receivedAt, fromIso), lte(pendingNotifications.receivedAt, toIso)))
      .all()
      .map((row) => JSON.parse(row.payload) as PendingNotification);
  }

  async addPendingNotification(notification: PendingNotification) {
    this.db
      .insert(pendingNotifications)
      .values({ id: notification.id, receivedAt: notification.source.receivedAt, payload: JSON.stringify(notification) })
      .run();
  }

  async removePendingNotification(id: string) {
    this.db.delete(pendingNotifications).where(eq(pendingNotifications.id, id)).run();
  }
}
