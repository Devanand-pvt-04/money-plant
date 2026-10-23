import * as Crypto from 'expo-crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { AccountClass } from '@money-plant/core';
import { accountTypes, accounts, type LocalAccountType } from '@money-plant/db-schema';
import { getDb } from './db';
import { notifyLedgerChange } from './events';

/** ACC-6: the user's own account types (Chit fund, PF, Gold). */
export async function listAccountTypes(): Promise<LocalAccountType[]> {
  const db = await getDb();
  return db
    .select()
    .from(accountTypes)
    .where(isNull(accountTypes.deletedAt))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createAccountType(input: { name: string; class: AccountClass; inNetWorth: boolean }): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  db.insert(accountTypes)
    .values({ id, name: input.name.trim(), class: input.class, inNetWorth: input.inNetWorth ? 1 : 0, createdAt: new Date().toISOString(), dirty: 1 })
    .run();
  notifyLedgerChange();
  return id;
}

/** The class is fixed once accounts use the type: it decides the sign of their balances. */
export async function updateAccountType(id: string, changes: { name?: string; inNetWorth?: boolean }): Promise<void> {
  const db = await getDb();
  db.update(accountTypes)
    .set({
      ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
      ...(changes.inNetWorth !== undefined ? { inNetWorth: changes.inNetWorth ? 1 : 0 } : {}),
      dirty: 1,
      rev: sql`${accountTypes.rev} + 1`,
    })
    .where(eq(accountTypes.id, id))
    .run();
  notifyLedgerChange();
}

export async function deleteAccountType(id: string): Promise<void> {
  const db = await getDb();
  const used = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.accountTypeId, id), isNull(accounts.deletedAt)))
    .get();
  if (used) throw new Error('Delete or move the accounts of this type first');
  db.update(accountTypes)
    .set({ deletedAt: new Date().toISOString(), dirty: 1, rev: sql`${accountTypes.rev} + 1` })
    .where(eq(accountTypes.id, id))
    .run();
  notifyLedgerChange();
}
