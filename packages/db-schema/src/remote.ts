import type { AccountClass, AccountType, Cadence } from '@money-plant/core';
import type {
  LocalAccount,
  LocalAccountType,
  LocalBalanceAnchor,
  LocalBudget,
  LocalItemLink,
  LocalPosting,
  LocalRecurring,
  LocalDeposit,
  LocalHolding,
  HoldingKind,
  LocalRule,
  LocalSharedItem,
  LocalPersonIdentifier,
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
  icon: string | null;
  vpa: string | null;
  email: string | null;
  /** Decision 0021. Missing from rows of a server without the migration. */
  extra_vpas?: string[];
  phone?: string | null;
  /** Decision 0024. Missing from rows of a server without the migration. */
  credit_limit_paise?: number | null;
  statement_day?: number | null;
  due_days?: number | null;
  bill_statement_on?: string | null;
  bill_due_on?: string | null;
  bill_total_paise?: number | null;
  bill_minimum_paise?: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** What the phone sends on push. user_id and updated_at are set by the server. */
export type RemoteAccountWrite = Omit<RemoteAccount, 'user_id' | 'updated_at'>;

/** A person's other UPI IDs from the local JSON column; anything unreadable is none (decision 0021). */
export function parseExtraVpas(json: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

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
    icon: row.icon,
    vpa: row.vpa,
    email: row.email,
    extra_vpas: parseExtraVpas(row.extraVpas),
    phone: row.phone,
    credit_limit_paise: row.creditLimitPaise,
    statement_day: row.statementDay,
    due_days: row.dueDays,
    bill_statement_on: row.billStatementOn,
    bill_due_on: row.billDueOn,
    bill_total_paise: row.billTotalPaise,
    bill_minimum_paise: row.billMinimumPaise,
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
    icon: row.icon ?? null,
    vpa: row.vpa ?? null,
    email: row.email ?? null,
    extraVpas: JSON.stringify(row.extra_vpas ?? []),
    phone: row.phone ?? null,
    creditLimitPaise: row.credit_limit_paise == null ? null : Number(row.credit_limit_paise),
    statementDay: row.statement_day ?? null,
    dueDays: row.due_days ?? null,
    billStatementOn: row.bill_statement_on ?? null,
    billDueOn: row.bill_due_on ?? null,
    billTotalPaise: row.bill_total_paise == null ? null : Number(row.bill_total_paise),
    billMinimumPaise: row.bill_minimum_paise == null ? null : Number(row.bill_minimum_paise),
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
  /** Minor units' currency (decision 0017). Missing before the currencies migration: INR. */
  currency?: string;
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
  postings: { id: string; account_id: string; amount_paise: number; currency: string; created_at: string }[];
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
      currency: p.currency,
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
        currency: p.currency ?? 'INR',
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
  note: string | null;
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
    note: row.note,
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
    note: row.note ?? null,
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
  currency?: string;
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
    currency: row.currency,
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
    currency: row.currency ?? 'INR',
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

/** Decision 0026: a row of public.shared_items, the creator's or a friend's. */
export interface RemoteSharedItem {
  id: string;
  user_id: string;
  kind: LocalSharedItem['kind'];
  flow: LocalSharedItem['flow'];
  amount_paise: number;
  currency: string;
  occurred_on: string;
  reason: string | null;
  category_name: string | null;
  group_ref: string | null;
  counterparty_email: string | null;
  counterparty_user_id: string | null;
  answer: LocalSharedItem['answer'];
  answered_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** What the creator sends. The other side and the answer are set by the server (shared_items_guard). */
export function toRemoteSharedItem(row: LocalSharedItem) {
  return {
    id: row.id,
    kind: row.kind,
    flow: row.flow,
    amount_paise: row.amountPaise,
    currency: row.currency,
    occurred_on: row.occurredOn,
    reason: row.reason,
    category_name: row.categoryName,
    group_ref: row.groupRef,
    counterparty_email: row.counterpartyEmail,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteSharedItem(row: RemoteSharedItem): LocalSharedItem {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    flow: row.flow,
    amountPaise: Number(row.amount_paise),
    currency: row.currency ?? 'INR',
    occurredOn: row.occurred_on,
    reason: row.reason,
    categoryName: row.category_name,
    groupRef: row.group_ref,
    counterpartyEmail: row.counterparty_email,
    counterpartyUserId: row.counterparty_user_id,
    answer: row.answer,
    answeredAt: row.answered_at === null ? null : iso(row.answered_at),
    myAnswer: null,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

/** Decision 0026: a row of public.item_links, always this user's own. */
export interface RemoteItemLink {
  id: string;
  user_id: string;
  item_id: string;
  person_account_id: string;
  transaction_id: string | null;
  linked_kind: LocalItemLink['linkedKind'];
  linked_flow: LocalItemLink['linkedFlow'];
  linked_paise: number | null;
  linked_currency: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteItemLink(row: LocalItemLink): Omit<RemoteItemLink, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    item_id: row.itemId,
    person_account_id: row.personAccountId,
    transaction_id: row.transactionId,
    linked_kind: row.linkedKind,
    linked_flow: row.linkedFlow,
    linked_paise: row.linkedPaise,
    linked_currency: row.linkedCurrency,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteItemLink(row: RemoteItemLink): LocalItemLink {
  return {
    id: row.id,
    itemId: row.item_id,
    personAccountId: row.person_account_id,
    transactionId: row.transaction_id,
    linkedKind: row.linked_kind ?? null,
    linkedFlow: row.linked_flow ?? null,
    linkedPaise: row.linked_paise === null || row.linked_paise === undefined ? null : Number(row.linked_paise),
    linkedCurrency: row.linked_currency ?? null,
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

export interface RemoteDeposit {
  id: string;
  user_id: string;
  account_id: string;
  kind: LocalDeposit['kind'];
  amount_paise: number;
  rate_bp: number;
  start_date: string;
  maturity_date: string;
  payout: LocalDeposit['payout'];
  paid_from_account_id: string | null;
  payee: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteDeposit(row: LocalDeposit): Omit<RemoteDeposit, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    account_id: row.accountId,
    kind: row.kind,
    amount_paise: row.amountPaise,
    rate_bp: row.rateBp,
    start_date: row.startDate,
    maturity_date: row.maturityDate,
    payout: row.payout,
    paid_from_account_id: row.paidFromAccountId,
    payee: row.payee,
    closed_at: row.closedAt,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteDeposit(row: RemoteDeposit): LocalDeposit {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    amountPaise: Number(row.amount_paise),
    rateBp: Number(row.rate_bp),
    startDate: row.start_date,
    maturityDate: row.maturity_date,
    payout: row.payout,
    paidFromAccountId: row.paid_from_account_id,
    payee: row.payee,
    closedAt: row.closed_at === null ? null : iso(row.closed_at),
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

export interface RemoteHolding {
  id: string;
  user_id: string;
  account_id: string;
  scheme: string;
  isin: string | null;
  amfi_code: string | null;
  folio: string | null;
  amc: string | null;
  units_e4: number;
  cost_paise: number;
  nav_e4: number | null;
  nav_date: string | null;
  as_of: string;
  sip_paise: number | null;
  sip_day: number | null;
  kind: HoldingKind;
  symbol: string | null;
  cost_known: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemoteHolding(row: LocalHolding): Omit<RemoteHolding, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    account_id: row.accountId,
    scheme: row.scheme,
    isin: row.isin,
    amfi_code: row.amfiCode,
    folio: row.folio,
    amc: row.amc,
    units_e4: row.unitsE4,
    cost_paise: row.costPaise,
    nav_e4: row.navE4,
    nav_date: row.navDate,
    as_of: row.asOf,
    sip_paise: row.sipPaise,
    sip_day: row.sipDay,
    kind: row.kind,
    symbol: row.symbol,
    cost_known: row.costKnown === 1,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemoteHolding(row: RemoteHolding): LocalHolding {
  const maybe = (value: number | null) => (value === null ? null : Number(value));
  return {
    id: row.id,
    accountId: row.account_id,
    scheme: row.scheme,
    isin: row.isin,
    amfiCode: row.amfi_code,
    folio: row.folio,
    amc: row.amc,
    unitsE4: Number(row.units_e4),
    costPaise: Number(row.cost_paise),
    navE4: maybe(row.nav_e4),
    navDate: row.nav_date,
    asOf: row.as_of,
    sipPaise: maybe(row.sip_paise),
    sipDay: maybe(row.sip_day),
    kind: row.kind ?? 'fund',
    symbol: row.symbol ?? null,
    costKnown: row.cost_known === false ? 0 : 1,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

/** Decision 0025: an identifier on one of the user's people. */
export interface RemotePersonIdentifier {
  id: string;
  user_id: string;
  person_account_id: string;
  kind: LocalPersonIdentifier['kind'];
  value: string;
  label: string | null;
  source: LocalPersonIdentifier['source'];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toRemotePersonIdentifier(row: LocalPersonIdentifier): Omit<RemotePersonIdentifier, 'user_id' | 'updated_at'> {
  return {
    id: row.id,
    person_account_id: row.personAccountId,
    kind: row.kind,
    value: row.value,
    label: row.label,
    source: row.source,
    created_at: row.createdAt,
    deleted_at: row.deletedAt,
  };
}

export function fromRemotePersonIdentifier(row: RemotePersonIdentifier): LocalPersonIdentifier {
  return {
    id: row.id,
    personAccountId: row.person_account_id,
    kind: row.kind,
    value: row.value,
    label: row.label,
    source: row.source,
    createdAt: iso(row.created_at),
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    dirty: 0,
    rev: 0,
  };
}

/** Decision 0025: one of the user's own identifiers, or a friend's shared one. */
export interface RemoteMyIdentifier {
  id: string;
  user_id: string;
  kind: LocalPersonIdentifier['kind'];
  value: string;
  label: string | null;
  shared: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
