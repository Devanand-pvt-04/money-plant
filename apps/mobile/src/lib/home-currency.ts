import { useSyncExternalStore } from 'react';
import { DEFAULT_CURRENCY, isCurrency, type CurrencyCode } from '@money-plant/core';
import { notifyLedgerChange } from './events';
import { supabase } from './supabase';

/**
 * The user's home currency (ACC-11, decision 0017): every total shows in it.
 * Kept in the Supabase user's metadata next to their name and UPI ID, so every
 * device has it, and read from the stored session, so it works offline.
 */

let current: CurrencyCode = DEFAULT_CURRENCY;
const listeners = new Set<() => void>();

/** The home currency right now. INR until the session says otherwise. */
export function homeCurrency(): CurrencyCode {
  return current;
}

/** Takes the home currency from the signed-in user's metadata. */
export function applyHomeCurrency(metadata: unknown): void {
  const value = metadata && typeof metadata === 'object' ? (metadata as { currency?: unknown }).currency : undefined;
  const next = isCurrency(value) ? value : DEFAULT_CURRENCY;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
  notifyLedgerChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when the home currency changes. */
export function useHomeCurrency(): CurrencyCode {
  return useSyncExternalStore(subscribe, homeCurrency, homeCurrency);
}

/** Needs the network: the metadata lives on the server. */
export async function setHomeCurrency(code: CurrencyCode): Promise<void> {
  if (!isCurrency(code)) throw new Error('Pick a currency from the list');
  const { error } = await supabase.auth.updateUser({ data: { currency: code } });
  if (error) throw error;
  applyHomeCurrency({ currency: code });
}
