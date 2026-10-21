import { eq } from 'drizzle-orm';
import { kv } from '@money-plant/db-schema';
import { getDb } from './db';

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.select().from(kv).where(eq(kv.key, key)).get();
  return row?.value ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}

export async function kvRemove(key: string): Promise<void> {
  const db = await getDb();
  await db.delete(kv).where(eq(kv.key, key));
}

/** Supabase auth storage backed by the encrypted database instead of plain localStorage. */
export const authStorage = {
  getItem: kvGet,
  setItem: kvSet,
  removeItem: kvRemove,
};
