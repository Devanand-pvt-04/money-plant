import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AccountClass, AccountType, Cadence } from '@money-plant/core';

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
    /** For `custom` accounts: the user-defined account type (ACC-6). */
    accountTypeId: text('account_type_id'),
    /** For categories: the parent category, one level up at most (CAT-5). */
    parentId: text('parent_id'),
    /** For categories: the standard category key the shared dictionary uses, e.g. "food.lunch". */
    categoryKey: text('category_key'),
    /** For people: their UPI ID, to pay them and recognise their payments (IOU-3, IOU-4). */
    vpa: text('vpa'),
    /** For people: the email they use Money Plant with, to share IOUs (IOU-2). */
    email: text('email'),
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
    kind: text('kind').$type<'expense' | 'income' | 'transfer' | 'adjustment' | 'iou'>().notNull(),
    status: text('status').$type<'pending' | 'confirmed'>().notNull(),
    confidence: real('confidence').notNull(),
    reviewReason: text('review_reason'),
    categoryReason: text('category_reason'),
    categoryRuleId: text('category_rule_id'),
    /** JSON array of fields the user changed by hand (LED-8). */
    userSetFields: text('user_set_fields').notNull().default('[]'),
    note: text('note'),
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

/** User-defined account types (ACC-6), on a fixed asset or liability class. */
export const accountTypes = sqliteTable('account_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  class: text('class').$type<AccountClass>().notNull(),
  inNetWorth: integer('in_net_worth').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
  dirty: integer('dirty').notNull().default(1),
  rev: integer('rev').notNull().default(0),
});

/** User rules and learned patterns (CAT-3, CAT-7, CAT-8). `match` is JSON, see RuleMatch and PatternMatch. */
export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<'rule' | 'pattern'>().notNull(),
    status: text('status').$type<'active' | 'paused' | 'proposed' | 'declined'>().notNull(),
    match: text('match').notNull(),
    categoryAccountId: text('category_account_id').notNull(),
    autoConfirm: integer('auto_confirm').notNull().default(1),
    hits: integer('hits').notNull().default(0),
    misses: integer('misses').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [index('rules_dirty_idx').on(table.dirty)],
);

/**
 * Monthly budgets (BUD-1). A null month is the category's default for every
 * month; a row with a month overrides it for that month only. A null category
 * is the overall budget. Ids are derived from user, month and category.
 */
export const budgets = sqliteTable(
  'budgets',
  {
    id: text('id').primaryKey(),
    month: text('month'),
    categoryAccountId: text('category_account_id'),
    limitPaise: integer('limit_paise'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [index('budgets_dirty_idx').on(table.dirty)],
);

/**
 * Local only: what the shared merchant dictionary and the AI said about each
 * merchant this phone asked about, keyed by normalised name. A null key means
 * nobody knew; `checked_at` decides when to ask again.
 */
export const merchantCache = sqliteTable('merchant_cache', {
  merchant: text('merchant').primaryKey(),
  categoryKey: text('category_key'),
  displayName: text('display_name'),
  confidence: real('confidence').notNull(),
  source: text('source').$type<'dictionary' | 'ai'>().notNull(),
  checkedAt: text('checked_at').notNull(),
});

/** Recurring payments: autopays, EMIs, rent and subscriptions (REC-1 to REC-4). See RecurringPayment in @money-plant/matcher. */
export const recurring = sqliteTable(
  'recurring',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    vpa: text('vpa'),
    merchant: text('merchant'),
    amountPaise: integer('amount_paise').notNull(),
    cadence: text('cadence').$type<Cadence>().notNull(),
    anchorDay: integer('anchor_day'),
    /** "2026-10-25", on the phone's calendar. */
    nextDue: text('next_due').notNull(),
    accountId: text('account_id'),
    categoryAccountId: text('category_account_id'),
    status: text('status').$type<'active' | 'paused' | 'proposed' | 'declined'>().notNull(),
    origin: text('origin').$type<'manual' | 'history' | 'pre_debit'>().notNull(),
    mandateRef: text('mandate_ref'),
    lastPaidAt: text('last_paid_at'),
    lastTransactionId: text('last_transaction_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [index('recurring_dirty_idx').on(table.dirty)],
);

/**
 * IOUs (IOU-1 to IOU-5). The same row as public.ious, so a shared IOU has
 * the owner's view of `person_account_id` and `direction`; lib/ious.ts turns
 * it round for the other person. `response` is local only: a confirm or
 * decline waiting to reach the server through respond_iou.
 */
export const ious = sqliteTable(
  'ious',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    ownerName: text('owner_name'),
    ownerEmail: text('owner_email'),
    ownerVpa: text('owner_vpa'),
    personAccountId: text('person_account_id').notNull(),
    direction: text('direction').$type<'lent' | 'borrowed'>().notNull(),
    amountPaise: integer('amount_paise').notNull(),
    reason: text('reason'),
    occurredOn: text('occurred_on').notNull(),
    dueDate: text('due_date'),
    transactionId: text('transaction_id'),
    counterpartyEmail: text('counterparty_email'),
    counterpartyUserId: text('counterparty_user_id'),
    counterpartyPersonAccountId: text('counterparty_person_account_id'),
    counterpartyTransactionId: text('counterparty_transaction_id'),
    counterpartyVpa: text('counterparty_vpa'),
    confirmedAt: text('confirmed_at'),
    declinedAt: text('declined_at'),
    response: text('response').$type<'accept' | 'decline'>(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [index('ious_dirty_idx').on(table.dirty)],
);

/** Repayments of IOUs, each recorded by the user whose ledger saw it (IOU-4). */
export const iouPayments = sqliteTable(
  'iou_payments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    iouId: text('iou_id').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    paidAt: text('paid_at').notNull(),
    transactionId: text('transaction_id'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    dirty: integer('dirty').notNull().default(1),
    rev: integer('rev').notNull().default(0),
  },
  (table) => [index('iou_payments_iou_idx').on(table.iouId), index('iou_payments_dirty_idx').on(table.dirty)],
);

/** Personal split groups: a trip, flatmates (SPL-3). `member_account_ids` is a JSON array of person account ids. */
export const splitGroups = sqliteTable('split_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  memberAccountIds: text('member_account_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
  deletedAt: text('deleted_at'),
  dirty: integer('dirty').notNull().default(1),
  rev: integer('rev').notNull().default(0),
});

/** Local only, never synced: which phone contact a person account is (SPL-4). */
export const personContacts = sqliteTable('person_contacts', {
  personAccountId: text('person_account_id').primaryKey(),
  contactId: text('contact_id').notNull(),
});

export type LocalAccount = typeof accounts.$inferSelect;
export type LocalIou = typeof ious.$inferSelect;
export type LocalIouPayment = typeof iouPayments.$inferSelect;
export type LocalSplitGroup = typeof splitGroups.$inferSelect;
export type LocalRecurring = typeof recurring.$inferSelect;
export type LocalAccountType = typeof accountTypes.$inferSelect;
export type LocalRule = typeof rules.$inferSelect;
export type LocalBudget = typeof budgets.$inferSelect;
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
  // Milestone 3: categories, account types, rules, patterns and budgets.
  `ALTER TABLE accounts ADD COLUMN account_type_id TEXT;
  ALTER TABLE accounts ADD COLUMN parent_id TEXT;
  ALTER TABLE accounts ADD COLUMN category_key TEXT;
  ALTER TABLE transactions ADD COLUMN category_reason TEXT;
  ALTER TABLE transactions ADD COLUMN category_rule_id TEXT;
  ALTER TABLE transactions ADD COLUMN user_set_fields TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE transactions ADD COLUMN note TEXT;
  CREATE TABLE account_types (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    class TEXT NOT NULL,
    in_net_worth INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE rules (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    match TEXT NOT NULL,
    category_account_id TEXT NOT NULL,
    auto_confirm INTEGER NOT NULL DEFAULT 1,
    hits INTEGER NOT NULL DEFAULT 0,
    misses INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX rules_dirty_idx ON rules (dirty);
  CREATE TABLE budgets (
    id TEXT PRIMARY KEY NOT NULL,
    month TEXT NOT NULL,
    category_account_id TEXT,
    limit_paise INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX budgets_dirty_idx ON budgets (dirty);
  CREATE TABLE merchant_cache (
    merchant TEXT PRIMARY KEY NOT NULL,
    category_key TEXT,
    display_name TEXT,
    confidence REAL NOT NULL,
    source TEXT NOT NULL,
    checked_at TEXT NOT NULL
  );
  CREATE INDEX accounts_parent_idx ON accounts (parent_id);`,
  // Milestone 4: recurring payments.
  `CREATE TABLE recurring (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    vpa TEXT,
    merchant TEXT,
    amount_paise INTEGER NOT NULL,
    cadence TEXT NOT NULL,
    anchor_day INTEGER,
    next_due TEXT NOT NULL,
    account_id TEXT,
    category_account_id TEXT,
    status TEXT NOT NULL,
    origin TEXT NOT NULL,
    mandate_ref TEXT,
    last_paid_at TEXT,
    last_transaction_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX recurring_dirty_idx ON recurring (dirty);`,
  // Milestone 4: people, IOUs, splits and groups.
  `ALTER TABLE accounts ADD COLUMN vpa TEXT;
  ALTER TABLE accounts ADD COLUMN email TEXT;
  CREATE TABLE ious (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    owner_name TEXT,
    owner_email TEXT,
    owner_vpa TEXT,
    person_account_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    reason TEXT,
    occurred_on TEXT NOT NULL,
    due_date TEXT,
    transaction_id TEXT,
    counterparty_email TEXT,
    counterparty_user_id TEXT,
    counterparty_person_account_id TEXT,
    counterparty_transaction_id TEXT,
    counterparty_vpa TEXT,
    confirmed_at TEXT,
    declined_at TEXT,
    response TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ious_dirty_idx ON ious (dirty);
  CREATE TABLE iou_payments (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    iou_id TEXT NOT NULL,
    amount_paise INTEGER NOT NULL,
    paid_at TEXT NOT NULL,
    transaction_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX iou_payments_iou_idx ON iou_payments (iou_id);
  CREATE INDEX iou_payments_dirty_idx ON iou_payments (dirty);
  CREATE TABLE split_groups (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    member_account_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE person_contacts (
    person_account_id TEXT PRIMARY KEY NOT NULL,
    contact_id TEXT NOT NULL
  );`,
  // App review round 1: a budget's month becomes optional (null is the default
  // for every month). Old rows meant "from this month on"; the server converts
  // them, so the phone drops its copy and pulls budgets again.
  `DROP TABLE budgets;
  CREATE TABLE budgets (
    id TEXT PRIMARY KEY NOT NULL,
    month TEXT,
    category_account_id TEXT,
    limit_paise INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    rev INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX budgets_dirty_idx ON budgets (dirty);
  DELETE FROM kv WHERE key = 'sync.budgets.cursor';`,
];
