import { syncFriendLinks } from './friends';
import { and, eq, inArray, isNotNull, isNull, ne, notInArray } from 'drizzle-orm';
import { isRejection, pushWithFallback } from '@money-plant/core';
import {
  accountTypes,
  accounts,
  balanceAnchors,
  budgets,
  deposits,
  holdings,
  fromRemoteAccount,
  fromRemoteAccountType,
  fromRemoteAnchor,
  fromRemoteBudget,
  fromRemoteDeposit,
  fromRemoteHolding,
  fromRemoteRecurring,
  fromRemoteRule,
  fromRemoteItemLink,
  fromRemoteSharedItem,
  fromRemotePersonIdentifier,
  fromRemoteTransaction,
  itemLinks,
  nextCursor,
  postings,
  recurring,
  rules,
  sources,
  sharedItems,
  personIdentifiers,
  toRemoteAccount,
  toRemoteAccountType,
  toRemoteAnchor,
  toRemoteBudget,
  toRemoteDeposit,
  toRemoteHolding,
  toRemoteRecurring,
  toRemoteRule,
  toRemoteItemLink,
  toRemoteSharedItem,
  toRemotePersonIdentifier,
  toTransactionPush,
  transactions,
  type RemoteAccount,
  type RemoteAccountType,
  type RemoteBalanceAnchor,
  type RemoteBudget,
  type RemoteDeposit,
  type RemoteHolding,
  type RemoteRecurring,
  type RemoteRule,
  type RemoteItemLink,
  type RemoteSharedItem,
  type RemotePersonIdentifier,
  type RemoteTransaction,
} from '@money-plant/db-schema';
import { ensureDefaultCategories } from './categories';
import { reportBackground } from './errors';
import { notifyLedgerChange } from './events';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';
import { wipeLocal } from './wipe';
import { loadMyIdentifiers } from './identity';
import { migrateAliases } from './people';
import { reconcileItems } from './shared';

const ACCOUNTS_CURSOR = 'sync.accounts.cursor';
const TRANSACTIONS_CURSOR = 'sync.transactions.cursor';
const ANCHORS_CURSOR = 'sync.balance_anchors.cursor';
const ACCOUNT_TYPES_CURSOR = 'sync.account_types.cursor';
const RULES_CURSOR = 'sync.rules.cursor';
const BUDGETS_CURSOR = 'sync.budgets.cursor';
const RECURRING_CURSOR = 'sync.recurring.cursor';
const DEPOSITS_CURSOR = 'sync.deposits.cursor';
const HOLDINGS_CURSOR = 'sync.holdings.cursor';
const PERSON_IDENTIFIERS_CURSOR = 'sync.person_identifiers.cursor';
const SHARED_ITEMS_CURSOR = 'sync.shared_items.cursor';
const ITEM_LINKS_CURSOR = 'sync.item_links.cursor';
/** When this phone last emptied itself after Clear my data (ACC-7), as the server's timestamp. */
const CLEARED_KEY = 'account.cleared_at';
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

/** Entries the server refused, by id, with the version refused. They wait until edited, so they don't hold back the rest. */
const SET_ASIDE_KEY = 'sync.transactions.set_aside';

async function readSetAside(): Promise<Record<string, number>> {
  try {
    const parsed: unknown = JSON.parse((await kvGet(SET_ASIDE_KEY)) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** How many changed entries the server refused and are waiting on this phone (shown in Settings → Health). */
export async function countSetAside(): Promise<number> {
  return Object.keys(await readSetAside()).length;
}

/**
 * Sends changed transactions with their postings and sources through the
 * push_transactions database function, which rejects unbalanced entries.
 * Raw SMS text is not part of the payload (see toTransactionPush).
 *
 * If the server refuses a batch, its entries are sent one by one, and any it
 * still refuses are set aside and recorded in the error log, so one bad entry
 * can't stop every later one from syncing. A set-aside entry is tried again
 * once it is edited (its rev changes).
 */
async function pushTransactions(): Promise<number> {
  const db = await getDb();
  // Forget entries edited or deleted on the phone since they were refused: they get another try.
  const stored = await readSetAside();
  const setAside: Record<string, number> = {};
  const storedIds = Object.keys(stored);
  if (storedIds.length > 0) {
    for (const row of db.select({ id: transactions.id, rev: transactions.rev, dirty: transactions.dirty }).from(transactions).where(inArray(transactions.id, storedIds)).all()) {
      if (row.dirty === 1 && row.rev === stored[row.id]) setAside[row.id] = row.rev;
    }
  }
  let pushed = 0;
  try {
    for (;;) {
      const waiting = Object.keys(setAside);
      const dirtyWhere = waiting.length > 0 ? and(eq(transactions.dirty, 1), notInArray(transactions.id, waiting)) : eq(transactions.dirty, 1);
      const dirty = db.select().from(transactions).where(dirtyWhere).limit(PUSH_BATCH).all();
      if (dirty.length === 0) return pushed;
      const ids = dirty.map((row) => row.id);
      const postingRows = db.select().from(postings).where(inArray(postings.transactionId, ids)).all();
      const sourceRows = db.select().from(sources).where(inArray(sources.transactionId, ids)).all();
      const payloadOf = (tx: (typeof dirty)[number]) =>
        toTransactionPush(
          tx,
          postingRows.filter((p) => p.transactionId === tx.id),
          sourceRows.filter((s) => s.transactionId === tx.id),
        );
      const outcome = await pushWithFallback(
        dirty,
        async (batch) => await supabase.rpc('push_transactions', { payload: batch.map(payloadOf) }),
        isRejection,
      );
      for (const row of outcome.sent) {
        db.update(transactions)
          .set({ dirty: 0 })
          .where(and(eq(transactions.id, row.id), eq(transactions.rev, row.rev)))
          .run();
      }
      for (const { item, error } of outcome.rejected) {
        setAside[item.id] = item.rev;
        reportBackground('sync-set-aside')(error);
      }
      pushed += outcome.sent.length;
      if (dirty.length < PUSH_BATCH) return pushed;
    }
  } finally {
    await kvSet(SET_ASIDE_KEY, JSON.stringify(setAside));
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

async function pushRecurring(): Promise<number> {
  const db = await getDb();
  return pushSimple('recurring', db.select().from(recurring).where(eq(recurring.dirty, 1)).all(), toRemoteRecurring, (row) =>
    db.update(recurring).set({ dirty: 0 }).where(and(eq(recurring.id, row.id), eq(recurring.rev, row.rev))).run(),
  );
}

async function pushDeposits(): Promise<number> {
  const db = await getDb();
  return pushSimple('deposits', db.select().from(deposits).where(eq(deposits.dirty, 1)).all(), toRemoteDeposit, (row) =>
    db.update(deposits).set({ dirty: 0 }).where(and(eq(deposits.id, row.id), eq(deposits.rev, row.rev))).run(),
  );
}

async function pushHoldings(): Promise<number> {
  const db = await getDb();
  return pushSimple('holdings', db.select().from(holdings).where(eq(holdings.dirty, 1)).all(), toRemoteHolding, (row) =>
    db.update(holdings).set({ dirty: 0 }).where(and(eq(holdings.id, row.id), eq(holdings.rev, row.rev))).run(),
  );
}

async function pushPersonIdentifiers(): Promise<number> {
  const db = await getDb();
  return pushSimple('person_identifiers', db.select().from(personIdentifiers).where(eq(personIdentifiers.dirty, 1)).all(), toRemotePersonIdentifier, (row) =>
    db.update(personIdentifiers).set({ dirty: 0 }).where(and(eq(personIdentifiers.id, row.id), eq(personIdentifiers.rev, row.rev))).run(),
  );
}

/**
 * Decision 0026: items this user created go up as rows. An answer to a
 * friend's share goes through answer_shared_item, which writes only the answer.
 */
async function pushSharedItems(me: string): Promise<number> {
  const db = await getDb();
  const owned = db.select().from(sharedItems).where(and(eq(sharedItems.dirty, 1), eq(sharedItems.userId, me))).all();
  let pushed = await pushSimple('shared_items', owned, toRemoteSharedItem, (row) =>
    db.update(sharedItems).set({ dirty: 0 }).where(and(eq(sharedItems.id, row.id), eq(sharedItems.rev, row.rev))).run(),
  );
  const answers = db.select().from(sharedItems).where(and(isNotNull(sharedItems.myAnswer), ne(sharedItems.userId, me))).all();
  for (const row of answers) {
    const { error } = await supabase.rpc('answer_shared_item', { p_id: row.id, p_accept: row.myAnswer === 'accepted' });
    // The friend removed it or moved it to someone else meanwhile: reconcileItems undoes this side.
    if (error?.code === '42501') {
      db.update(sharedItems).set({ myAnswer: null, deletedAt: new Date().toISOString() }).where(eq(sharedItems.id, row.id)).run();
      continue;
    }
    if (error) throw error;
    db.update(sharedItems)
      .set({ myAnswer: null, answer: row.myAnswer })
      .where(and(eq(sharedItems.id, row.id), eq(sharedItems.myAnswer, row.myAnswer!)))
      .run();
    pushed++;
  }
  return pushed;
}

async function pushItemLinks(): Promise<number> {
  const db = await getDb();
  return pushSimple('item_links', db.select().from(itemLinks).where(eq(itemLinks.dirty, 1)).all(), toRemoteItemLink, (row) =>
    db.update(itemLinks).set({ dirty: 0 }).where(and(eq(itemLinks.id, row.id), eq(itemLinks.rev, row.rev))).run(),
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

async function pullRecurring(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteRecurring>('recurring', '*', RECURRING_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: recurring.dirty }).from(recurring).where(eq(recurring.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteRecurring(row);
      db.insert(recurring).values(incoming).onConflictDoUpdate({ target: recurring.id, set: incoming }).run();
    }
  });
}

async function pullDeposits(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteDeposit>('deposits', '*', DEPOSITS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: deposits.dirty }).from(deposits).where(eq(deposits.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteDeposit(row);
      db.insert(deposits).values(incoming).onConflictDoUpdate({ target: deposits.id, set: incoming }).run();
    }
  });
}

async function pullHoldings(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteHolding>('holdings', '*', HOLDINGS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: holdings.dirty }).from(holdings).where(eq(holdings.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteHolding(row);
      db.insert(holdings).values(incoming).onConflictDoUpdate({ target: holdings.id, set: incoming }).run();
    }
  });
}

async function pullPersonIdentifiers(): Promise<number> {
  const db = await getDb();
  return pullTable<RemotePersonIdentifier>('person_identifiers', '*', PERSON_IDENTIFIERS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: personIdentifiers.dirty }).from(personIdentifiers).where(eq(personIdentifiers.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemotePersonIdentifier(row);
      db.insert(personIdentifiers).values(incoming).onConflictDoUpdate({ target: personIdentifiers.id, set: incoming }).run();
    }
  });
}

/** Both this user's items and friends' items with them (row-level security decides which). */
async function pullSharedItems(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteSharedItem>('shared_items', '*', SHARED_ITEMS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: sharedItems.dirty, myAnswer: sharedItems.myAnswer }).from(sharedItems).where(eq(sharedItems.id, row.id)).get();
      // An edit or an answer not yet sent wins.
      if (local?.dirty === 1 || local?.myAnswer) continue;
      const incoming = fromRemoteSharedItem(row);
      db.insert(sharedItems).values(incoming).onConflictDoUpdate({ target: sharedItems.id, set: incoming }).run();
    }
  });
}

async function pullItemLinks(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteItemLink>('item_links', '*', ITEM_LINKS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: itemLinks.dirty }).from(itemLinks).where(eq(itemLinks.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteItemLink(row);
      db.insert(itemLinks).values(incoming).onConflictDoUpdate({ target: itemLinks.id, set: incoming }).run();
    }
  });
}

/**
 * A friend's item moved to someone else (a new email) is hidden from this
 * user by the server, so its change never comes down in the pull. Any of
 * their items on the phone the server no longer shows is marked gone here;
 * reconcileItems then undoes what this user's ledger has for it.
 */
async function dropHiddenItems(me: string): Promise<number> {
  const db = await getDb();
  const local = db
    .select({ id: sharedItems.id })
    .from(sharedItems)
    .where(and(ne(sharedItems.userId, me), isNull(sharedItems.deletedAt), isNull(sharedItems.myAnswer)))
    .all();
  if (local.length === 0) return 0;
  const visible = new Set<string>();
  for (let offset = 0; ; offset += PULL_PAGE) {
    const { data, error } = await supabase
      .from('shared_items')
      .select('id')
      .neq('user_id', me)
      .is('deleted_at', null)
      .order('id')
      .range(offset, offset + PULL_PAGE - 1);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string }[]) visible.add(row.id);
    if ((data ?? []).length < PULL_PAGE) break;
  }
  const hidden = local.filter((r) => !visible.has(r.id)).map((r) => r.id);
  if (hidden.length > 0) db.update(sharedItems).set({ deletedAt: new Date().toISOString() }).where(inArray(sharedItems.id, hidden)).run();
  return hidden.length;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
}

let running: Promise<SyncResult> | null = null;
let held = false;

/**
 * Runs `work` with sync stopped: a sync already running finishes first, and
 * none starts until `work` is done. Clearing data uses it so nothing on the
 * phone is pushed back while the server copy is being deleted.
 */
export async function holdSync<T>(work: () => Promise<T>): Promise<T> {
  held = true;
  try {
    await running?.catch(() => {});
    return await work();
  } finally {
    held = false;
  }
}

/** Notes that this phone's copy is from after the clear at `at`, so it is not wiped again. */
export async function recordClear(at: string): Promise<void> {
  await kvSet(CLEARED_KEY, at);
}

/**
 * ACC-7 on the user's other phones: Clear my data stamps the user's metadata,
 * and a phone whose copy is older than the stamp empties itself before it
 * could push old rows back. A phone that has never synced has nothing old.
 */
async function wipeIfClearedElsewhere(clearedAt: unknown): Promise<void> {
  if (typeof clearedAt !== 'string') return;
  const local = await kvGet(CLEARED_KEY);
  if (local !== null && local >= clearedAt) return;
  if (local === null && (await kvGet(ACCOUNTS_CURSOR)) === null) return recordClear(clearedAt);
  await wipeLocal({ keepSession: true });
  await recordClear(clearedAt);
}

/**
 * Push then pull, in reference order: account types, accounts (including
 * categories), rules, transactions, anchors, budgets, recurring payments,
 * deposits, holdings, identifiers, shared items, item links. Postings point at accounts, rules,
 * budgets, recurring payments, deposits and holdings at accounts and categories, anchors at
 * sources, links at items, people and entries. Concurrent calls share one run.
 */
export function syncNow(): Promise<SyncResult> {
  running ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session || held) return { pushed: 0, pulled: 0 };
      const me = data.session.user.id;
      await wipeIfClearedElsewhere(data.session.user.user_metadata?.data_cleared_at);
      await ensureDefaultCategories();
      const pushed =
        (await pushAccountTypes()) +
        (await pushAccounts()) +
        (await pushRules()) +
        (await pushTransactions()) +
        (await pushAnchors()) +
        (await pushBudgets()) +
        (await pushRecurring()) +
        (await pushDeposits()) +
        (await pushHoldings()) +
        (await pushPersonIdentifiers()) +
        (await pushSharedItems(me)) +
        (await pushItemLinks());
      const pulled =
        (await pullAccountTypes()) +
        (await pullAccounts()) +
        (await pullRules()) +
        (await pullTransactions()) +
        (await pullAnchors()) +
        (await pullBudgets()) +
        (await pullRecurring()) +
        (await pullDeposits()) +
        (await pullHoldings()) +
        (await pullPersonIdentifiers()) +
        (await pullSharedItems()) +
        (await dropHiddenItems(me)) +
        (await pullItemLinks());
      // ACC-9: friends' links become person accounts. Best effort: a failure here never stops the ledger sync.
      await syncFriendLinks().catch(reportBackground('friend-links'));
      // Decision 0025: payee names kept on this phone become identifiers once, and the user's own profile is cached for capture.
      await migrateAliases().catch(reportBackground('aliases'));
      await loadMyIdentifiers(me).catch(reportBackground('my-identifiers'));
      // Decision 0026: entries follow what changed on items (a new amount, a removal, an answer).
      const reconciled = await reconcileItems().catch((e) => {
        reportBackground('shared-items')(e);
        return 0;
      });
      // What reconciling changed goes up in a run of its own, once this one has finished.
      if (reconciled > 0) setTimeout(() => void syncNow().catch(() => {}), 0);
      // Screens out of view reload on their next focus only after a change, so say when one came in.
      if (pulled > 0) notifyLedgerChange();
      return { pushed, pulled };
    } catch (e) {
      // Most callers don't wait for sync, so a failure would go unseen; the caller still gets it.
      reportBackground('sync')(e);
      throw e;
    } finally {
      running = null;
    }
  })();
  return running;
}
