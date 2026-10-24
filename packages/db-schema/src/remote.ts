import type { AccountClass, AccountType, Cadence } from '@money-plant/core';
import type {
  LocalAccount,
  LocalAccountType,
  LocalBalanceAnchor,
  LocalBudget,
  LocalIou,
  LocalIouPayment,
  LocalPosting,
  LocalRecurring,
  LocalRule,
  LocalSplitGroup,
  LocalSource,
  LocalTransaction,
} from './sqlite';

/** A row of public.accounts as the Supabase API returns it. */
export interface RemoteAccount {
  id: string;
  user_id: string;
  type: AccountType;
  name: string;
  institution: string | null;
  last4: string | null;
  currency: string;
  opening_balance_paise: number;
  account_type_id: string | null;
  parent_id: string | null;
  category_key: string | null;
  vpa: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** What the phone sends on push. user_id and updated_at are set by the server. */
export type RemoteAccountWrite = Omit<RemoteAccount, 'user_id' | 'updated_at'>;

export function toRemoteAccount(row: LocalAccount): RemoteAccountWrite {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    institution: row.institution,
    last4: row.last4,
    currency: row.currency,
    opening_balance_paise: row.openingBalancePaise,
    account_type_id: row.accountTypeId,
    parent_id: row.parentId,
    category_key: row.categoryKey,
    vpa: row.vpa,
    email: row.email,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteAccount(row: RemoteAccount): LocalAccount {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    institution: row.institution,
    last4: row.last4,
    currency: row.currency,
    openingBalancePaise: Number(row.opening_balance_paise),
    accountTypeId: row.account_type_id ?? null,
    parentId: row.parent_id ?? null,
    categoryKey: row.category_key ?? null,
    vpa: row.vpa ?? null,
    email: row.email ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

/**
 * Postgres returns "2026-10-21T10:00:00+00:00"; the phone writes toISOString().
 * Local queries compare timestamps as text, so pulled ones are normalised.
 * updated_at is left as the server sent it, because it is the pull cursor.
 */
const iso = (value: string) => new Date(value).toISOString();

/** A row of public.transactions with its postings and sources embedded, as pulled. */
export interface RemoteTransaction {
  id: string;
  user_id: string;
  occurred_at: string;
  counterparty: string | null;
  kind: LocalTransaction['kind'];
  status: LocalTransaction['status'];
  confidence: number;
  review_reason: string | null;
  category_reason: string | null;
  category_rule_id: string | null;
  user_set_fields: string[] | null;
  note: string | null;
  split_group_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  postings: RemotePosting[];
  sources: RemoteSource[];
}

export interface RemotePosting {
  id: string;
  transaction_id: string;
  account_id: string;
  amount_paise: number;
  created_at: string;
  deleted_at: string | null;
}

/** The server copy of a source has the parsed fields only; there is no column for the message text. */
export interface RemoteSource {
  id: string;
  transaction_id: string;
  kind: string;
  sender: string | null;
  external_ref: string | null;
  fingerprint: string;
  parsed_fields: Record<string, unknown>;
  received_at: string;
  confidence: number;
  created_at: string;
  deleted_at: string | null;
}

/** One element of the payload for the push_transactions database function. */
export interface TransactionPush {
  id: string;
  occurred_at: string;
  counterparty: string | null;
  kind: LocalTransaction['kind'];
  status: LocalTransaction['status'];
  confidence: number;
  review_reason: string | null;
  category_reason: string | null;
  category_rule_id: string | null;
  user_set_fields: string[];
  note: string | null;
  split_group_id: string | null;
  created_at: string;
  deleted_at: string | null;
  postings: { id: string; account_id: string; amount_paise: number; created_at: string }[];
  sources: {
    id: string;
    kind: string;
    sender: string | null;
    external_ref: string | null;
    fingerprint: string;
    parsed_fields: Record<string, unknown>;
    received_at: string;
    confidence: number;
    created_at: string;
  }[];
}

/**
 * Builds the push payload for a transaction. Fields are copied one by one so
 * that a source's raw_text can never ride along.
 */
export function toTransactionPush(
  tx: LocalTransaction,
  txPostings: readonly LocalPosting[],
  txSources: readonly LocalSource[],
): TransactionPush {
  return {
    id: tx.id,
    occurred_at: tx.occurredAt,
    counterparty: tx.counterparty,
    kind: tx.kind,
    status: tx.status,
    confidence: tx.confidence,
    review_reason: tx.reviewReason,
    category_reason: tx.categoryReason,
    category_rule_id: tx.categoryRuleId,
    user_set_fields: JSON.parse(tx.userSetFields) as string[],
    note: tx.note,
    split_group_id: tx.splitGroupId,
    created_at: tx.createdAt,
    deleted_at: tx.deletedAt,
    postings: txPostings.map((p) => ({
      id: p.id,
      account_id: p.accountId,
      amount_paise: p.amountPaise,
      created_at: p.createdAt,
    })),
    sources: txSources.map((s) => ({
      id: s.id,
      kind: s.kind,
      sender: s.sender,
      external_ref: s.externalRef,
      fingerprint: s.fingerprint,
      parsed_fields: JSON.parse(s.parsedFields) as Record<string, unknown>,
      received_at: s.receivedAt,
      confidence: s.confidence,
      created_at: s.createdAt,
    })),
  };
}

export function fromRemoteTransaction(row: RemoteTransaction): {
  transaction: LocalTransaction;
  postings: LocalPosting[];
  sources: Omit<LocalSource, 'rawText'>[];
} {
  return {
    transaction: {
      id: row.id,
      occurredAt: iso(row.occurred_at),
      counterparty: row.counterparty,
      kind: row.kind,
      status: row.status,
      confidence: Number(row.confidence),
      reviewReason: row.review_reason,
      categoryReason: row.category_reason ?? null,
      categoryRuleId: row.category_rule_id ?? null,
      userSetFields: JSON.stringify(row.user_set_fields ?? []),
      note: row.note ?? null,
      splitGroupId: row.split_group_id ?? null,
      createdAt: iso(row.created_at),
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
      dirty: 0,
      rev: 0,
    },
    postings: row.postings
      .filter((p) => p.deleted_at === null)
      .map((p) => ({
        id: p.id,
        transactionId: row.id,
        accountId: p.account_id,
        amountPaise: Number(p.amount_paise),
        createdAt: iso(p.created_at),
      })),
    sources: row.sources
      .filter((s) => s.deleted_at === null)
      .map((s) => ({
        id: s.id,
        transactionId: row.id,
        kind: s.kind,
        sender: s.sender,
        externalRef: s.external_ref,
        fingerprint: s.fingerprint,
        parsedFields: JSON.stringify(s.parsed_fields ?? {}),
        receivedAt: iso(s.received_at),
        confidence: Number(s.confidence),
        createdAt: iso(s.created_at),
      })),
  };
}

export interface RemoteBalanceAnchor {
  id: string;
  user_id: string;
  account_id: string;
  balance_paise: number;
  observed_at: string;
  source_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type RemoteBalanceAnchorWrite = Omit<RemoteBalanceAnchor, 'user_id' | 'updated_at'>;

export function toRemoteAnchor(row: LocalBalanceAnchor): RemoteBalanceAnchorWrite {
  return {
    id: row.id,
    account_id: row.accountId,
    balance_paise: row.balancePaise,
    observed_at: row.observedAt,
    source_id: row.sourceId,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteAnchor(row: RemoteBalanceAnchor): LocalBalanceAnchor {
  return {
    id: row.id,
    accountId: row.account_id,
    balancePaise: Number(row.balance_paise),
    observedAt: iso(row.observed_at),
    sourceId: row.source_id,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteAccountType {
  id: string;
  user_id: string;
  name: string;
  class: AccountClass;
  in_net_worth: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteAccountType(row: LocalAccountType): Omit<RemoteAccountType, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    name: row.name,
    class: row.class,
    in_net_worth: row.inNetWorth === 1,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteAccountType(row: RemoteAccountType): LocalAccountType {
  return {
    id: row.id,
    name: row.name,
    class: row.class,
    inNetWorth: row.in_net_worth ? 1 : 0,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteRule {
  id: string;
  user_id: string;
  kind: LocalRule['kind'];
  status: LocalRule['status'];
  match: Record<string, unknown>;
  category_account_id: string;
  auto_confirm: boolean;
  hits: number;
  misses: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteRule(row: LocalRule): Omit<RemoteRule, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    match: JSON.parse(row.match) as Record<string, unknown>,
    category_account_id: row.categoryAccountId,
    auto_confirm: row.autoConfirm === 1,
    hits: row.hits,
    misses: row.misses,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteRule(row: RemoteRule): LocalRule {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    match: JSON.stringify(row.match),
    categoryAccountId: row.category_account_id,
    autoConfirm: row.auto_confirm ? 1 : 0,
    hits: Number(row.hits),
    misses: Number(row.misses),
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteBudget {
  id: string;
  user_id: string;
  /** First day of the month, "2026-10-01"; null for the default that applies to every month. */
  month: string | null;
  category_account_id: string | null;
  limit_paise: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Locally a month is "2026-10"; Postgres stores the first day as a date. */
export function toRemoteBudget(row: LocalBudget): Omit<RemoteBudget, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    month: row.month === null ? null : `${row.month}-01`,
    category_account_id: row.categoryAccountId,
    limit_paise: row.limitPaise,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteBudget(row: RemoteBudget): LocalBudget {
  return {
    id: row.id,
    month: row.month === null ? null : row.month.slice(0, 7),
    categoryAccountId: row.category_account_id,
    limitPaise: row.limit_paise === null ? null : Number(row.limit_paise),
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteRecurring {
  id: string;
  user_id: string;
  name: string;
  vpa: string | null;
  merchant: string | null;
  amount_paise: number;
  cadence: Cadence;
  anchor_day: number | null;
  next_due: string;
  account_id: string | null;
  category_account_id: string | null;
  status: LocalRecurring['status'];
  origin: LocalRecurring['origin'];
  mandate_ref: string | null;
  last_paid_at: string | null;
  last_transaction_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteRecurring(row: LocalRecurring): Omit<RemoteRecurring, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    name: row.name,
    vpa: row.vpa,
    merchant: row.merchant,
    amount_paise: row.amountPaise,
    cadence: row.cadence,
    anchor_day: row.anchorDay,
    next_due: row.nextDue,
    account_id: row.accountId,
    category_account_id: row.categoryAccountId,
    status: row.status,
    origin: row.origin,
    mandate_ref: row.mandateRef,
    last_paid_at: row.lastPaidAt,
    last_transaction_id: row.lastTransactionId,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteRecurring(row: RemoteRecurring): LocalRecurring {
  return {
    id: row.id,
    name: row.name,
    vpa: row.vpa,
    merchant: row.merchant,
    amountPaise: Number(row.amount_paise),
    cadence: row.cadence,
    anchorDay: row.anchor_day === null ? null : Number(row.anchor_day),
    nextDue: row.next_due,
    accountId: row.account_id,
    categoryAccountId: row.category_account_id,
    status: row.status,
    origin: row.origin,
    mandateRef: row.mandate_ref,
    lastPaidAt: row.last_paid_at === null ? null : iso(row.last_paid_at),
    lastTransactionId: row.last_transaction_id,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteIou {
  id: string;
  user_id: string;
  owner_name: string | null;
  owner_email: string | null;
  owner_vpa: string | null;
  person_account_id: string;
  direction: LocalIou['direction'];
  amount_paise: number;
  reason: string | null;
  occurred_on: string;
  due_date: string | null;
  transaction_id: string | null;
  counterparty_email: string | null;
  counterparty_user_id: string | null;
  counterparty_person_account_id: string | null;
  counterparty_transaction_id: string | null;
  counterparty_vpa: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * What the owner sends. The counterparty's fields, the response times and
 * owner_email are set on the server (ious_guard, respond_iou), so they are
 * left out; the server would ignore them anyway.
 */
export function toRemoteIou(row: LocalIou) {
  return {
    id: row.id,
    owner_name: row.ownerName,
    owner_vpa: row.ownerVpa,
    person_account_id: row.personAccountId,
    direction: row.direction,
    amount_paise: row.amountPaise,
    reason: row.reason,
    occurred_on: row.occurredOn,
    due_date: row.dueDate,
    transaction_id: row.transactionId,
    counterparty_email: row.counterpartyEmail,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteIou(row: RemoteIou): LocalIou {
  return {
    id: row.id,
    userId: row.user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    ownerVpa: row.owner_vpa,
    personAccountId: row.person_account_id,
    direction: row.direction,
    amountPaise: Number(row.amount_paise),
    reason: row.reason,
    occurredOn: row.occurred_on,
    dueDate: row.due_date,
    transactionId: row.transaction_id,
    counterpartyEmail: row.counterparty_email,
    counterpartyUserId: row.counterparty_user_id,
    counterpartyPersonAccountId: row.counterparty_person_account_id,
    counterpartyTransactionId: row.counterparty_transaction_id,
    counterpartyVpa: row.counterparty_vpa,
    confirmedAt: row.confirmed_at === null ? null : iso(row.confirmed_at),
    declinedAt: row.declined_at === null ? null : iso(row.declined_at),
    response: null,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteIouPayment {
  id: string;
  user_id: string;
  iou_id: string;
  amount_paise: number;
  paid_at: string;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteIouPayment(row: LocalIouPayment): Omit<RemoteIouPayment, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    iou_id: row.iouId,
    amount_paise: row.amountPaise,
    paid_at: row.paidAt,
    transaction_id: row.transactionId,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteIouPayment(row: RemoteIouPayment): LocalIouPayment {
  return {
    id: row.id,
    userId: row.user_id,
    iouId: row.iou_id,
    amountPaise: Number(row.amount_paise),
    paidAt: iso(row.paid_at),
    transactionId: row.transaction_id,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteSplitGroup {
  id: string;
  user_id: string;
  name: string;
  member_account_ids: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteSplitGroup(row: LocalSplitGroup): Omit<RemoteSplitGroup, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    name: row.name,
    member_account_ids: JSON.parse(row.memberAccountIds) as string[],
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteSplitGroup(row: RemoteSplitGroup): LocalSplitGroup {
  return {
    id: row.id,
    name: row.name,
    memberAccountIds: JSON.stringify(row.member_account_ids ?? []),
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

/** Latest updated_at in a pulled batch, used as the next pull cursor. */
export function nextCursor(rows: readonly { updated_at: string }[], previous: string | null): string | null {
  let cursor = previous;
  for (const row of rows) {
    if (cursor === null || Date.parse(row.updated_at) > Date.parse(cursor)) cursor = row.updated_at;
  }
  return cursor;
}
