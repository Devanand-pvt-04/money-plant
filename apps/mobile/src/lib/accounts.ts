import * as Crypto from 'expo-crypto';
import { eq, sql } from 'drizzle-orm';
import { DEFAULT_CURRENCY, type AccountType, type CurrencyCode, type Paise } from '@money-plant/core';
import { accounts, balanceRefs } from '@money-plant/db-schema';
import { getDb } from './db';
import { notifyLedgerChange } from './events';

export interface AccountInput {
  type: AccountType;
  /** For `custom` accounts (ACC-6). */
  accountTypeId?: string | null;
  name: string;
  institution: string | null;
  last4: string | null;
  /** Signed: money owed on a card, loan or liability type is negative. In minor units of `currency`. */
  openingBalance: Paise;
  /** INR when left out (ACC-12). */
  currency?: CurrencyCode;
}

/**
 * Types that can hold another currency (decision 0017). Deposits, funds,
 * stocks, NPS and savings schemes are Indian products priced in rupees.
 */
export const FOREIGN_CAPABLE_TYPES: ReadonlySet<AccountType> = new Set(['bank', 'cash', 'wallet', 'credit_card', 'loan', 'custom']);

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
    currency: FOREIGN_CAPABLE_TYPES.has(input.type) ? (input.currency ?? DEFAULT_CURRENCY) : DEFAULT_CURRENCY,
    createdAt,
    dirty: 1,
  });
  notifyLedgerChange();
  return id;
}

/** Soft delete, so the deletion syncs to other devices. */
export async function deleteAccount(id: string): Promise<void> {
  const db = await getDb();
  await db
    .update(accounts)
    .set({ deletedAt: new Date().toISOString(), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id));
  notifyLedgerChange();
}
