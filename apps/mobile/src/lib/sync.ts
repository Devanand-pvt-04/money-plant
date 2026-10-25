import { and, eq, inArray, isNotNull } from 'drizzle-orm';
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
  fromRemoteIou,
  fromRemoteIouPayment,
  fromRemoteRecurring,
  fromRemoteRule,
  fromRemoteSplitGroup,
  fromRemoteTransaction,
  iouPayments,
  ious,
  nextCursor,
  postings,
  recurring,
  rules,
  sources,
  splitGroups,
  toRemoteAccount,
  toRemoteAccountType,
  toRemoteAnchor,
  toRemoteBudget,
  toRemoteDeposit,
  toRemoteHolding,
  toRemoteIou,
  toRemoteIouPayment,
  toRemoteRecurring,
  toRemoteRule,
  toRemoteSplitGroup,
  toTransactionPush,
  transactions,
  type RemoteAccount,
  type RemoteAccountType,
  type RemoteBalanceAnchor,
  type RemoteBudget,
  type RemoteDeposit,
  type RemoteHolding,
  type RemoteIou,
  type RemoteIouPayment,
  type RemoteRecurring,
  type RemoteRule,
  type RemoteSplitGroup,
  type RemoteTransaction,
} from '@money-plant/db-schema';
import { ensureDefaultCategories } from './categories';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';
import { wipeLocal } from './wipe';

const ACCOUNTS_CURSOR = 'sync.accounts.cursor';
const TRANSACTIONS_CURSOR = 'sync.transactions.cursor';
const ANCHORS_CURSOR = 'sync.balance_anchors.cursor';
const ACCOUNT_TYPES_CURSOR = 'sync.account_types.cursor';
const RULES_CURSOR = 'sync.rules.cursor';
const BUDGETS_CURSOR = 'sync.budgets.cursor';
const RECURRING_CURSOR = 'sync.recurring.cursor';
const DEPOSITS_CURSOR = 'sync.deposits.cursor';
const HOLDINGS_CURSOR = 'sync.holdings.cursor';
const SPLIT_GROUPS_CURSOR = 'sync.split_groups.cursor';
const IOUS_CURSOR = 'sync.ious.cursor';
const IOU_PAYMENTS_CURSOR = 'sync.iou_payments.cursor';
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

async function pushSplitGroups(): Promise<number> {
  const db = await getDb();
  return pushSimple('split_groups', db.select().from(splitGroups).where(eq(splitGroups.dirty, 1)).all(), toRemoteSplitGroup, (row) =>
    db.update(splitGroups).set({ dirty: 0 }).where(and(eq(splitGroups.id, row.id), eq(splitGroups.rev, row.rev))).run(),
  );
}

/**
 * IOUs this user added go up as rows. An answer to one shared with them goes
 * through respond_iou, which only writes the answering side's fields (IOU-2).
 */
async function pushIous(me: string): Promise<number> {
  const db = await getDb();
  const owned = db.select().from(ious).where(and(eq(ious.dirty, 1), eq(ious.userId, me))).all();
  let pushed = await pushSimple('ious', owned, toRemoteIou, (row) =>
    db.update(ious).set({ dirty: 0 }).where(and(eq(ious.id, row.id), eq(ious.rev, row.rev))).run(),
  );
  const answers = db.select().from(ious).where(isNotNull(ious.response)).all();
  for (const row of answers) {
    const { error } = await supabase.rpc('respond_iou', {
      p_id: row.id,
      p_accept: row.response === 'accept',
      p_person_account_id: row.counterpartyPersonAccountId,
      p_transaction_id: row.counterpartyTransactionId,
      p_vpa: row.counterpartyVpa,
    });
    if (error?.code === '42501') {
      // The owner deleted it or shared it with someone else meanwhile: it is no longer this user's to answer.
      db.delete(ious).where(eq(ious.id, row.id)).run();
      continue;
    }
    if (error) throw error;
    db.update(ious).set({ response: null }).where(and(eq(ious.id, row.id), eq(ious.response, row.response!))).run();
    // Repayments the owner recorded before this user confirmed are older than the pull cursor.
    if (row.response === 'accept') await pullPaymentsOf([row.id]);
    pushed++;
  }
  return pushed;
}

/** Only this user's own repayment records; the other side's come down in the pull. */
async function pushIouPayments(me: string): Promise<number> {
  const db = await getDb();
  return pushSimple(
    'iou_payments',
    db.select().from(iouPayments).where(and(eq(iouPayments.dirty, 1), eq(iouPayments.userId, me))).all(),
    toRemoteIouPayment,
    (row) => db.update(iouPayments).set({ dirty: 0 }).where(and(eq(iouPayments.id, row.id), eq(iouPayments.rev, row.rev))).run(),
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

async function pullSplitGroups(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteSplitGroup>('split_groups', '*', SPLIT_GROUPS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: splitGroups.dirty }).from(splitGroups).where(eq(splitGroups.id, row.id)).get();
      if (local?.dirty === 1) continue;
      const incoming = fromRemoteSplitGroup(row);
      db.insert(splitGroups).values(incoming).onConflictDoUpdate({ target: splitGroups.id, set: incoming }).run();
    }
  });
}

/** Both the user's own IOUs and ones shared with them (RLS decides which). */
async function pullIous(me: string): Promise<number> {
  const db = await getDb();
  const confirmed: string[] = [];
  const total = await pullTable<RemoteIou>('ious', '*', IOUS_CURSOR, async (rows) => {
    for (const row of rows) {
      const local = db.select({ dirty: ious.dirty, response: ious.response }).from(ious).where(eq(ious.id, row.id)).get();
      // An edit or an answer not yet sent wins.
      if (local?.dirty === 1 || local?.response) continue;
      const incoming = fromRemoteIou(row);
      db.insert(ious).values(incoming).onConflictDoUpdate({ target: ious.id, set: incoming }).run();
      if (row.user_id !== me && row.confirmed_at) confirmed.push(row.id);
    }
  });
  // A confirmation from another of this user's phones: the repayments on it may be older than the cursor.
  if (confirmed.length > 0) await pullPaymentsOf(confirmed);
  return total;
}

function applyPayments(db: Awaited<ReturnType<typeof getDb>>, rows: readonly RemoteIouPayment[]): void {
  for (const row of rows) {
    const local = db.select({ dirty: iouPayments.dirty }).from(iouPayments).where(eq(iouPayments.id, row.id)).get();
    if (local?.dirty === 1) continue;
    const incoming = fromRemoteIouPayment(row);
    db.insert(iouPayments).values(incoming).onConflictDoUpdate({ target: iouPayments.id, set: incoming }).run();
  }
}

async function pullPaymentsOf(iouIds: readonly string[]): Promise<void> {
  const db = await getDb();
  for (let i = 0; i < iouIds.length; i += 100) {
    const { data, error } = await supabase.from('iou_payments').select('*').in('iou_id', iouIds.slice(i, i + 100));
    if (error) throw error;
    applyPayments(db, (data ?? []) as RemoteIouPayment[]);
  }
}

async function pullIouPayments(): Promise<number> {
  const db = await getDb();
  return pullTable<RemoteIouPayment>('iou_payments', '*', IOU_PAYMENTS_CURSOR, async (rows) => applyPayments(db, rows));
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
 * deposits, holdings, split groups, IOUs, IOU repayments. Postings point at accounts, rules,
 * budgets, recurring payments, deposits, holdings, groups and IOUs at accounts and categories,
 * anchors at sources, repayments at IOUs. Concurrent calls share one run.
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
        (await pushSplitGroups()) +
        (await pushIous(me)) +
        (await pushIouPayments(me));
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
        (await pullSplitGroups()) +
        (await pullIous(me)) +
        (await pullIouPayments());
      return { pushed, pulled };
    } finally {
      running = null;
    }
  })();
  return running;
}
