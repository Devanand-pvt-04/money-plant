import * as Crypto from 'expo-crypto';
import { asc, eq, isNull } from 'drizzle-orm';
import type { AccountType, Paise } from '@money-plant/core';
import { accounts, type LocalAccount } from '@money-plant/db-schema';
import { getDb } from './db';

export interface AccountInput {
  type: AccountType;
  name: string;
  institution: string | null;
  last4: string | null;
  openingBalance: Paise;
}

export async function listAccounts(): Promise<LocalAccount[]> {
  const db = await getDb();
  return db.select().from(accounts).where(isNull(accounts.deletedAt)).orderBy(asc(accounts.name));
}

export async function createAccount(input: AccountInput): Promise<void> {
  const db = await getDb();
  await db.insert(accounts).values({
    id: Crypto.randomUUID(),
    type: input.type,
    name: input.name,
    institution: input.institution,
    last4: input.last4,
    openingBalancePaise: input.openingBalance,
    createdAt: new Date().toISOString(),
    dirty: 1,
  });
}

/** Soft delete, so the deletion syncs to other devices. */
export async function deleteAccount(id: string): Promise<void> {
  const db = await getDb();
  await db
    .update(accounts)
    .set({ deletedAt: new Date().toISOString(), dirty: 1 })
    .where(eq(accounts.id, id));
}
