import type { AccountType, Paise } from '@money-plant/core';
import type { CategoryReason } from '@money-plant/categoriser';
import type { Direction } from '@money-plant/parser';

export interface LedgerAccount {
  id: string;
  type: AccountType;
  name: string;
  institution: string | null;
  last4: string | null;
}

export type NewLedgerAccount = Omit<LedgerAccount, 'id'>;

/** Category accounts the capture pipeline posts to until milestone 3 adds real categories. */
export type SystemAccountKey = 'uncategorised_expense' | 'uncategorised_income' | 'adjustments';

export const SYSTEM_ACCOUNT_NAMES: Record<SystemAccountKey, string> = {
  uncategorised_expense: 'Uncategorised spending',
  uncategorised_income: 'Uncategorised income',
  adjustments: 'Balance adjustments',
};

export const SOURCE_KINDS = ['sms', 'notification', 'statement', 'cas', 'manual', 'shortcut', 'app_payment'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface LedgerSource {
  id: string;
  kind: SourceKind;
  /** Normalised SMS header ("HDFCBK") or app name ("Google Pay"). */
  sender: string | null;
  externalRef: string | null;
  /** Hash identifying the original message, so re-reading the inbox never duplicates it. */
  fingerprint: string;
  /** The parser's output. Never the message text. */
  parsedFields: Record<string, unknown>;
  receivedAt: string;
  confidence: number;
  /** Original text, kept only in the phone's encrypted database (LED-2). Never synced. */
  rawText: string | null;
}

export interface LedgerPosting {
  id: string;
  accountId: string;
  amount: Paise;
}

export type TransactionKind = 'expense' | 'income' | 'transfer' | 'adjustment' | 'iou';
export type TransactionStatus = 'pending' | 'confirmed';

/** Why an entry is waiting in the review inbox (LED-6). */
export type ReviewReason =
  | 'low_confidence'
  | 'unknown_account'
  | 'person'
  | 'possible_transfer'
  | 'pattern'
  | 'category_unsure'
  | 'payment_unconfirmed';

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  low_confidence: 'The message was hard to read',
  unknown_account: 'Not sure which account this was',
  person: 'Payment to or from a person',
  possible_transfer: 'Looks like a transfer between your accounts',
  pattern: 'Matched one of your patterns',
  category_unsure: 'Not sure about the category',
  payment_unconfirmed: "The UPI app didn't say if this payment went through",
};

/**
 * LED-8: fields the user changed by hand. Re-parsing, dedupe, sync and AI
 * never overwrite them.
 */
export const USER_SET_FIELDS = ['category', 'counterparty', 'amount', 'account', 'occurredAt', 'note', 'kind'] as const;
export type UserSetField = (typeof USER_SET_FIELDS)[number];

export interface LedgerTransaction {
  id: string;
  occurredAt: string;
  counterparty: string | null;
  kind: TransactionKind;
  status: TransactionStatus;
  confidence: number;
  reviewReason: ReviewReason | null;
  /** Why the entry has its category (CAT-6); null while it is uncategorised. */
  categoryReason: CategoryReason | null;
  /** The rule or pattern that set the category, when categoryReason is rule or pattern. */
  categoryRuleId: string | null;
  userSetFields: UserSetField[];
  note: string | null;
  /** SPL-3: the group an expense was added to, if any. Left out when unknown, so a write keeps what is stored. */
  splitGroupId?: string | null;
  postings: LedgerPosting[];
  sources: LedgerSource[];
}

/**
 * Where the opening balance comes from. The opening balance is always
 * `ref.balance - sum(postings up to ref.at)`, so importing older SMS never
 * changes the balance the user entered or the bank reported.
 *   user: the user typed the balance at `at`.
 *   anchor: the earliest balance the bank reported in an SMS.
 */
export interface BalanceRef {
  kind: 'user' | 'anchor';
  balance: Paise;
  at: string;
}

export interface BalanceAnchor {
  id: string;
  accountId: string;
  balance: Paise;
  observedAt: string;
  sourceId: string;
}

/** A UPI app notification that arrived before its bank SMS. Parsed fields only. */
export interface PendingNotification {
  id: string;
  direction: Direction;
  amount: Paise;
  counterparty: string | null;
  source: LedgerSource;
}

/**
 * Storage the pipeline needs. The phone implements it on SQLite; tests use
 * MemoryStore. Deleted transactions are never returned by transactionsBetween,
 * but their sources still count for hasFingerprint.
 */
export interface LedgerStore {
  listAccounts(): Promise<LedgerAccount[]>;
  createAccount(account: LedgerAccount): Promise<void>;
  setAccountLast4(accountId: string, last4: string): Promise<void>;
  systemAccount(key: SystemAccountKey): Promise<LedgerAccount>;

  hasFingerprint(fingerprint: string): Promise<boolean>;
  transactionsBetween(fromIso: string, toIso: string): Promise<LedgerTransaction[]>;
  /** Inserts or replaces a transaction with exactly these postings and sources. */
  saveTransaction(transaction: LedgerTransaction): Promise<void>;

  addAnchor(anchor: BalanceAnchor): Promise<void>;
  getBalanceRef(accountId: string): Promise<BalanceRef | null>;
  setBalanceRef(accountId: string, ref: BalanceRef): Promise<void>;
  /** Sum of postings to the account in live transactions occurring at or before `upToIso`. */
  sumPostings(accountId: string, upToIso: string): Promise<Paise>;
  setOpeningBalance(accountId: string, opening: Paise): Promise<void>;

  pendingNotifications(fromIso: string, toIso: string): Promise<PendingNotification[]>;
  addPendingNotification(notification: PendingNotification): Promise<void>;
  removePendingNotification(id: string): Promise<void>;
}
