import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
    /** Bumped on every local change, so a push only clears `dirty` for the version it sent. */
    rev: integer('rev').notNull().default(0),
  },
  (table) => [index('accounts_dirty_idx').on(table.dirty)],
);

/** Small key-value store for the auth session and sync cursors, kept in the encrypted database. */
export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Local copy of public.transactions. Postings and sources are pushed together with their transaction. */
export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    occurredAt: text('occurred_at').notNull(),
    counterparty: text('counterparty'),
    kind: text('kind').$type<'expense' | 'income' | 'transfer' | 'adjustment'>().notNull(),
    status: text('status').$type<'pending' | 'confirmed'>().notNull(),
    confidence: real('confidence').notNull(),
    reviewReason: text('review_reason'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [
    index('transactions_occurred_idx').on(table.occurredAt),
    index('transactions_dirty_idx').on(table.dirty),
    index('transactions_status_idx').on(table.status),
  ],
);

export const postings = sqliteTable(
  'postings',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id').notNull(),
    accountId: text('account_id').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('postings_transaction_idx').on(table.transactionId), index('postings_account_idx').on(table.accountId)],
);

/**
 * Where an entry came from (LED-2). `raw_text` is the original message and is
 * local only: it is never selected for sync, logs or AI.
 */
export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    transactionId: text('transaction_id').notNull(),
    kind: text('kind').notNull(),
    sender: text('sender'),
    externalRef: text('external_ref'),
    fingerprint: text('fingerprint').notNull(),
    parsedFields: text('parsed_fields').notNull(),
    receivedAt: text('received_at').notNull(),
    confidence: real('confidence').notNull(),
    rawText: text('raw_text'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('sources_transaction_idx').on(table.transactionId), uniqueIndex('sources_fingerprint_idx').on(table.fingerprint)],
);

/** Balances the bank reported in SMS (LED-7). */
export const balanceAnchors = sqliteTable(
  'balance_anchors',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    balancePaise: integer('balance_paise').notNull(),
    observedAt: text('observed_at').notNull(),
    sourceId: text('source_id').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [index('balance_anchors_account_idx').on(table.accountId), index('balance_anchors_dirty_idx').on(table.dirty)],
);

/** Local only: what each account's opening balance is derived from (see BalanceRef in @money-plant/matcher). */
export const balanceRefs = sqliteTable('balance_refs', {
  accountId: text('account_id').primaryKey(),
  kind: text('kind').$type<'user' | 'anchor'>().notNull(),
  balancePaise: integer('balance_paise').notNull(),
  at: text('at').notNull(),
});

/** Local only: UPI app notifications waiting for their bank SMS. Parsed fields only. */
export const pendingNotifications = sqliteTable('pending_notifications', {
  id: text('id').primaryKey(),
  receivedAt: text('received_at').notNull(),
  payload: text('payload').notNull(),
});

/**
 * Local only: one row per bank message read, for parse-failure stats (CAP-8).
 * `raw_text` is kept only for failures, so the user can see what went wrong.
 */
export const captureLog = sqliteTable(
  'capture_log',
  {
    fingerprint: text('fingerprint').primaryKey(),
    channel: text('channel').$type<'sms' | 'notification'>().notNull(),
    sender: text('sender').notNull(),
    receivedAt: text('received_at').notNull(),
    status: text('status').$type<'parsed' | 'ignored' | 'failed'>().notNull(),
    reason: text('reason'),
    rawText: text('raw_text'),
  },
  (table) => [index('capture_log_sender_idx').on(table.sender)],
);

export type LocalAccount = typeof accounts.$inferSelect;
export type LocalTransaction = typeof transactions.$inferSelect;
export type LocalPosting = typeof postings.$inferSelect;
export type LocalSource = typeof sources.$inferSelect;
export type LocalBalanceAnchor = typeof balanceAnchors.$inferSelect;
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
  // Milestone 2: ledger and capture.
  `ALTER TABLE accounts ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY NOT NULL,
    occurred_at TEXT NOT NULL,
    counterparty TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    confidence REAL NOT NULL,
    review_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX transactions_occurred_idx ON transactions (occurred_at);
  CREATE INDEX transactions_dirty_idx ON transactions (dirty);
  CREATE INDEX transactions_status_idx ON transactions (status);
  CREATE TABLE postings (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX postings_transaction_idx ON postings (transaction_id);
  CREATE INDEX postings_account_idx ON postings (account_id);
  CREATE TABLE sources (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    sender TEXT,
    external_ref TEXT,
    fingerprint TEXT NOT NULL,
    parsed_fields TEXT NOT NULL,
    received_at TEXT NOT NULL,
    confidence REAL NOT NULL,
    raw_text TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX sources_transaction_idx ON sources (transaction_id);
  CREATE UNIQUE INDEX sources_fingerprint_idx ON sources (fingerprint);
  CREATE TABLE balance_anchors (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    balance_paise INTEGER NOT NULL,
    observed_at TEXT NOT NULL,
    source_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX balance_anchors_account_idx ON balance_anchors (account_id);
  CREATE INDEX balance_anchors_dirty_idx ON balance_anchors (dirty);
  CREATE TABLE balance_refs (
    account_id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    balance_paise INTEGER NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE pending_notifications (
    id TEXT PRIMARY KEY NOT NULL,
    received_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE capture_log (
    fingerprint TEXT PRIMARY KEY NOT NULL,
    channel TEXT NOT NULL,
    sender TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    raw_text TEXT
  );
  CREATE INDEX capture_log_sender_idx ON capture_log (sender);`,
];
