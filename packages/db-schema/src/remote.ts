import type { AccountType } from '@money-plant/core';
import type { LocalAccount, LocalBalanceAnchor, LocalPosting, LocalSource, LocalTransaction } from './sqlite';

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

/** Latest updated_at in a pulled batch, used as the next pull cursor. */
export function nextCursor(rows: readonly { updated_at: string }[], previous: string | null): string | null {
  let cursor = previous;
  for (const row of rows) {
    if (cursor === null || Date.parse(row.updated_at) > Date.parse(cursor)) cursor = row.updated_at;
  }
  return cursor;
}
