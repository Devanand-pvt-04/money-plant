import { and, eq, inArray } from 'drizzle-orm';
import {
  accounts,
  balanceAnchors,
  fromRemoteAccount,
  fromRemoteAnchor,
  fromRemoteTransaction,
  nextCursor,
  postings,
  sources,
  toRemoteAccount,
  toRemoteAnchor,
  toTransactionPush,
  transactions,
  type RemoteAccount,
  type RemoteBalanceAnchor,
  type RemoteTransaction,
} from '@money-plant/db-schema';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';

const ACCOUNTS_CURSOR = 'sync.accounts.cursor';
const TRANSACTIONS_CURSOR = 'sync.transactions.cursor';
const ANCHORS_CURSOR = 'sync.balance_anchors.cursor';
const PUSH_BATCH = 200;
const PULL_PAGE = 500;

/** Sends accounts changed on this phone. The server stamps updated_at; last writer wins. */
async function pushAccounts(): Promise<number> {
  const db = await getDb();
  const dirty = db.select().from(accounts).where(eq(accounts.dirty, 1)).all();
  if (dirty.length === 0) return 0;

  const { error } = await supabase.from('accounts').upsert(dirty.map(toRemoteAccount));
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

export interface SyncResult {
  pushed: number;
  pulled: number;
}

let running: Promise<SyncResult> | null = null;

/**
 * Push then pull. Accounts go first and anchors last, because postings point
 * at accounts and anchors point at sources. Concurrent calls share one run.
 */
export function syncNow(): Promise<SyncResult> {
  running ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return { pushed: 0, pulled: 0 };
      const pushed = (await pushAccounts()) + (await pushTransactions()) + (await pushAnchors());
      const pulled = (await pullAccounts()) + (await pullTransactions()) + (await pullAnchors());
      return { pushed, pulled };
    } finally {
      running = null;
    }
  })();
  return running;
}
