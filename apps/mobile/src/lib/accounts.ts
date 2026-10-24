import * as Crypto from 'expo-crypto';
import { eq, sql } from 'drizzle-orm';
import type { AccountType, Paise } from '@money-plant/core';
import { accounts, balanceRefs } from '@money-plant/db-schema';
import { getDb } from './db';

export interface AccountInput {
  type: AccountType;
  /** For `custom` accounts (ACC-6). */
  accountTypeId?: string | null;
  name: string;
  institution: string | null;
  last4: string | null;
  /** Signed: money owed on a card, loan or liability type is negative. */
  openingBalance: Paise;
}

/** Returns the new account's id. */
export async function createAccount(input: AccountInput): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  const createdAt = new Date().toISOString();
  // The balance the user typed is the balance now; SMS imported later for earlier dates must not change it.
  await db.insert(balanceRefs).values({ accountId: id, kind: 'user', balancePaise: input.openingBalance, at: createdAt });
  await db.insert(accounts).values({
    id,
    type: input.type,
    name: input.name,
    institution: input.institution,
    last4: input.last4,
    accountTypeId: input.accountTypeId ?? null,
    openingBalancePaise: input.openingBalance,
    createdAt,
    dirty: 1,
  });
  return id;
}

/** Soft delete, so the deletion syncs to other devices. */
export async function deleteAccount(id: string): Promise<void> {
  const db = await getDb();
  await db
    .update(accounts)
    .set({ deletedAt: new Date().toISOString(), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id));
}
