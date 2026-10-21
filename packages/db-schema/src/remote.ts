import type { AccountType } from '@money-plant/core';
import type { LocalAccount } from './sqlite';

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
  };
}

/** Latest updated_at in a pulled batch, used as the next pull cursor. */
export function nextCursor(rows: readonly RemoteAccount[], previous: string | null): string | null {
  let cursor = previous;
  for (const row of rows) {
    if (cursor === null || Date.parse(row.updated_at) > Date.parse(cursor)) cursor = row.updated_at;
  }
  return cursor;
}
