import { and, eq, inArray } from 'drizzle-orm';
import {
  accountTypes,
  accounts,
  balanceAnchors,
  budgets,
  fromRemoteAccount,
  fromRemoteAccountType,
  fromRemoteAnchor,
  fromRemoteBudget,
  fromRemoteRule,
  fromRemoteTransaction,
  nextCursor,
  postings,
  rules,
  sources,
  toRemoteAccount,
  toRemoteAccountType,
  toRemoteAnchor,
  toRemoteBudget,
  toRemoteRule,
  toTransactionPush,
  transactions,
  type RemoteAccount,
  type RemoteAccountType,
  type RemoteBalanceAnchor,
  type RemoteBudget,
  type RemoteRule,
  type RemoteTransaction,
} from '@money-plant/db-schema';
import { ensureDefaultCategories } from './categories';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';

const ACCOUNTS_CURSOR = 'sync.accounts.cursor';
const TRANSACTIONS_CURSOR = 'sync.transactions.cursor';
const ANCHORS_CURSOR = 'sync.balance_anchors.cursor';
const ACCOUNT_TYPES_CURSOR = 'sync.account_types.cursor';
const RULES_CURSOR = 'sync.rules.cursor';
const BUDGETS_CURSOR = 'sync.budgets.cursor';
const PUSH_BATCH = 200;
const PULL_PAGE = 500;

/** Sends accounts changed on this phone. The server stamps updated_at; last writer wins. */
async function pushAccounts(): Promise<number> {
  const db = await getDb();
  const dirty = db.select().from(accounts).where(eq(accounts.dirty, 1)).all();
  if (dirty.length === 0) return 0;

  // Default categories this phone seeded but never synced may already exist on the server,
  // renamed or moved on another phone. Insert those only if missing, so the other phone's edits win.
  const seeded = dirty.filter((row) => row.type === 'category' && row.updatedAt === null && row.categoryKey !== null);
  const edited = dirty.filter((row) => !seeded.includes(row));
  if (seeded.length > 0) {
    const { error } = await supabase.from('accounts').upsert(seeded.map(toRemoteAccount), { ignoreDuplicates: true });
    if (error) throw error;
  }
  const { error } = edited.length > 0 ? await supabase.from('accounts').upsert(edited.map(toRemoteAccount)) : { error: null };
  if (error) throw error;
  // Only clear rows unchanged since they were read; a capture may have edited one meanwhile.
  for (const row of dirty) {
    db.update(accounts).set({ dirty: 0 }).where(and(eq(accounts.id, row.id), eq(accounts.rev, row.rev))).run();
  }
  return dirty.length;
}

/**
 * Sends changed transactions with their postings and sources through the
 * push_transactions database function, which rejects unbalanced entries.
 * Raw SMS text is not part of the payload (see toTransactionPush).
 */
async function pushTransactions(): Promise<number> {
  const db = await getDb();
  let pushed = 0;
  for (;;) {
    const dirty = db.select().from(transactions).where(eq(transactions.dirty, 1)).limit(PUSH_BATCH).all();
    if (dirty.length === 0) return pushed;
    const ids = dirty.map((row) => row.id);
    const postingRows = db.select().from(postings).where(inArray(postings.transactionId, ids)).all();
    const sourceRows = db.select().from(sources).where(inArray(sources.transactionId, ids)).all();
    const payload = dirty.map((tx) =>
      toTransactionPush(
        tx,
        postingRows.filter((p) => p.transactionId === tx.id),
        sourceRows.filter((s) => s.transactionId === tx.id),
      ),
    );
    const { error } = await supabase.rpc('push_transactions', { payload });
    if (error) throw error;
    for (const row of dirty) {
      db.update(transactions)
        .set({ dirty: 0 })
        .where(and(eq(transactions.id, row.id), eq(transactions.rev, row.rev)))
        .run();
    }
    pushed += dirty.length;
    if (dirty.length < PUSH_BATCH) return pushed;
  }
}

async function pushAnchors(): Promise<number> {
  const db = await getDb();
  const dirty = db.select().from(balanceAnchors).where(eq(balanceAnchors.dirty, 1)).all();
  if (dirty.length === 0) return 0;
  const { error } = await supabase.from('balance_anchors').upsert(dirty.map(toRemoteAnchor));
  if (error) throw error;
  for (const row of dirty) {
    db.update(balanceAnchors)
      .set({ dirty: 0 })
      .where(and(eq(balanceAnchors.id, row.id), eq(balanceAnchors.rev, row.rev)))
      .run();
  }
  return dirty.length;
}

/** Pushes rows of a simple synced table (one row, no children), clearing dirty only for the version sent. */
async function pushSimple<Row extends { id: string; rev: number }>(
  table: string,
  rows: Row[],
  toRemote: (row: Row) => object,
  clear: (row: Row) => void,
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await supabase.from(table).upsert(rows.map(toRemote));
  if (error) throw error;
  rows.forEach(clear);
  return rows.length;
}

async function pushAccountTypes(): Promise<number> {
  const db = await getDb();
  return pushSimple('account_types', db.select().from(accountTypes).where(eq(accountTypes.dirty, 1)).all(), toRemoteAccountType, (row) =>
    db.update(accountTypes).set({ dirty: 0 }).where(and(eq(accountTypes.id, row.id), eq(accountTypes.rev, row.rev))).run(),
  );
}

async function pushRules(): Promise<number> {
  const db = await getDb();
  return pushSimple('rules', db.select().from(rules).where(eq(rules.dirty, 1)).all(), toRemoteRule, (row) =>
    db.update(rules).set({ dirty: 0 }).where(and(eq(rules.id, row.id), eq(rules.rev, row.rev))).run(),
  );
}

async function pushBudgets(): Promise<number> {
  const db = await getDb();
  return pushSimple('budgets', db.select().from(budgets).where(eq(budgets.dirty, 1)).all(), toRemoteBudget, (row) =>
    db.update(budgets).set({ dirty: 0 }).where(and(eq(budgets.id, row.id), eq(budgets.rev, row.rev))).run(),
  );
}

/** Pages through rows changed since the cursor, oldest first, and applies each page. */
async function pullTable<Row extends { updated_at: string }>(
  table: string,
  select: string,
  cursorKey: string,
  apply: (rows: Row[]) => Promise<void>,
): Promise<number> {
  const cursor = await kvGet(cursorKey);
  let total = 0;
  let next = cursor;
  for (let offset = 0; ; offset += PULL_PAGE) {
    let query = supabase.from(table).select(select).order('updated_at', { ascending: true }).order('id');
    // gte, not gt: rows written in one statement share a timestamp. Re-applying a row is harmless.
    if (cursor) query = query.gte('updated_at', cursor);
    const { data, error } = await query.range(offset, offset + PULL_PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Row[];
    await apply(rows);
    total += rows.length;
    next = nextCursor(rows, next);
    if (rows.length < PULL_PAGE) break;
  }
  if (next && next !== cursor) await kvSet(cursorKey, next);
  return total;
}

async function pullAccounts(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteAccount>('accounts', '*', ACCOUNTS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: accounts.dirty }).from(accounts).where(eq(accounts.id, row.id)).get();
      // A local edit not yet pushed wins; it reaches the server on the next push.
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteAccount(row);
      db.insert(accounts).values(incoming).onConflictDoUpdate({ target: accounts.id, set: incoming }).run();
    }
  });
}

async function pullTransactions(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteTransaction>('transactions', '*, postings(*), sources(*)', TRANSACTIONS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: transactions.dirty }).from(transactions).where(eq(transactions.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteTransaction(row);
      db.transaction((t) => {
        t.insert(transactions)
          .values(incoming.transaction)
          .onConflictDoUpdate({ target: transactions.id, set: incoming.transaction })
          .run();
        // Postings are always replaced as a set together with their transaction.
        t.delete(postings).where(eq(postings.transactionId, row.id)).run();
        if (incoming.postings.length > 0) t.insert(postings).values(incoming.postings).run();
        for (const source of incoming.sources) {
          const exists = t.select({ id: sources.id }).from(sources).where(eq(sources.id, source.id)).get();
          // Keep the local raw_text: the server never has it.
          if (exists) t.update(sources).set(source).where(eq(sources.id, source.id)).run();
          else t.insert(sources).values({ ...source, rawText: null }).onConflictDoNothing().run();
        }
      });
    }
  });
}

async function pullAnchors(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteBalanceAnchor>('balance_anchors', '*', ANCHORS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: balanceAnchors.dirty }).from(balanceAnchors).where(eq(balanceAnchors.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteAnchor(row);
      db.insert(balanceAnchors).values(incoming).onConflictDoUpdate({ target: balanceAnchors.id, set: incoming }).run();
    }
  });
}

async function pullAccountTypes(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteAccountType>('account_types', '*', ACCOUNT_TYPES_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: accountTypes.dirty }).from(accountTypes).where(eq(accountTypes.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteAccountType(row);
      db.insert(accountTypes).values(incoming).onConflictDoUpdate({ target: accountTypes.id, set: incoming }).run();
    }
  });
}

async function pullRules(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteRule>('rules', '*', RULES_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: rules.dirty }).from(rules).where(eq(rules.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteRule(row);
      db.insert(rules).values(incoming).onConflictDoUpdate({ target: rules.id, set: incoming }).run();
    }
  });
}

async function pullBudgets(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteBudget>('budgets', '*', BUDGETS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: budgets.dirty }).from(budgets).where(eq(budgets.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteBudget(row);
      db.insert(budgets).values(incoming).onConflictDoUpdate({ target: budgets.id, set: incoming }).run();
    }
  });
}

export interface SyncResult {
  pushed: number;
  pulled: number;
}

let running: Promise<SyncResult> | null = null;

/**
 * Push then pull, in reference order: account types, accounts (including
 * categories), rules, transactions, anchors, budgets. Postings point at
 * accounts, rules and budgets at categories, anchors at sources. Concurrent
 * calls share one run.
 */
export function syncNow(): Promise<SyncResult> {
  running ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return { pushed: 0, pulled: 0 };
      await ensureDefaultCategories();
      const pushed =
        (await pushAccountTypes()) +
        (await pushAccounts()) +
        (await pushRules()) +
        (await pushTransactions()) +
        (await pushAnchors()) +
        (await pushBudgets());
      const pulled =
        (await pullAccountTypes()) +
        (await pullAccounts()) +
        (await pullRules()) +
        (await pullTransactions()) +
        (await pullAnchors()) +
        (await pullBudgets());
      return { pushed, pulled };
    } finally {
      running = null;
    }
  })();
  return running;
}
