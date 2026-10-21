import { eq, inArray } from 'drizzle-orm';
import {
  accounts,
  fromRemoteAccount,
  nextCursor,
  toRemoteAccount,
  type RemoteAccount,
} from '@money-plant/db-schema';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';

const CURSOR_KEY = 'sync.accounts.cursor';

/** Sends rows changed on this phone. The server stamps updated_at; last writer wins. */
async function pushAccounts(): Promise<number> {
  const db = await getDb();
  const dirty = await db.select().from(accounts).where(eq(accounts.dirty, 1));
  if (dirty.length === 0) return 0;

  const { data, error } = await supabase
    .from('accounts')
    .upsert(dirty.map(toRemoteAccount))
    .select('id, updated_at');
  if (error) throw error;

  const pushedIds = (data ?? []).map((row) => row.id as string);
  if (pushedIds.length > 0) {
    // Leave the cursor alone: the pull below fetches these rows back with server timestamps.
    await db.update(accounts).set({ dirty: 0 }).where(inArray(accounts.id, pushedIds));
  }
  return pushedIds.length;
}

/** Fetches rows changed on any device since the last pull. */
async function pullAccounts(): Promise<number> {
  const db = await getDb();
  const cursor = await kvGet(CURSOR_KEY);

  let query = supabase.from('accounts').select('*').order('updated_at', { ascending: true });
  // gte, not gt: rows written in one statement share a timestamp. Re-applying a row is harmless.
  if (cursor) query = query.gte('updated_at', cursor);
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as RemoteAccount[];
  for (const row of rows) {
    const local = await db.select().from(accounts).where(eq(accounts.id, row.id)).get();
    // A local edit not yet pushed wins; it reaches the server on the next push.
    if (local?.dirty === 1) continue;
    const incoming = fromRemoteAccount(row);
    await db
      .insert(accounts)
      .values(incoming)
      .onConflictDoUpdate({ target: accounts.id, set: incoming });
  }

  const next = nextCursor(rows, cursor);
  if (next && next !== cursor) await kvSet(CURSOR_KEY, next);
  return rows.length;
}

let running: Promise<{ pushed: number; pulled: number }> | null = null;

/** Push then pull. Concurrent calls share one run. */
export function syncNow(): Promise<{ pushed: number; pulled: number }> {
  running ??= (async () => {
    try {
      const pushed = await pushAccounts();
      const pulled = await pullAccounts();
      return { pushed, pulled };
    } finally {
      running = null;
    }
  })();
  return running;
}
