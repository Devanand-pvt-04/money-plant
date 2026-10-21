import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { AccountType } from '@money-plant/core';

/**
 * Local copy of public.accounts (see supabase/migrations). Extra local-only
 * column: `dirty` is 1 while the row has changes not yet pushed to Supabase.
 * `updatedAt` holds the server timestamp from the last successful sync.
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    type: text('type').$type<AccountType>().notNull(),
    name: text('name').notNull(),
    institution: text('institution'),
    last4: text('last4'),
    currency: text('currency').notNull().default('INR'),
    openingBalancePaise: integer('opening_balance_paise').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
  },
  (table) => [index('accounts_dirty_idx').on(table.dirty)],
);

/** Small key-value store for the auth session and sync cursors, kept in the encrypted database. */
export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export type LocalAccount = typeof accounts.$inferSelect;
export type NewLocalAccount = typeof accounts.$inferInsert;

/**
 * Ordered local migrations, applied once each using PRAGMA user_version.
 * Never edit a shipped entry; append a new one instead.
 */
export const LOCAL_MIGRATIONS: readonly string[] = [
  `CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    institution TEXT,
    last4 TEXT,
    currency TEXT NOT NULL DEFAULT 'INR',
    opening_balance_paise INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX accounts_dirty_idx ON accounts (dirty);
  CREATE TABLE kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );`,
];
