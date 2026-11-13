import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { notifyLedgerChange } from './events';

/**
 * Settings → Round off summaries: totals, balances and charts show whole
 * rupees (₹1,250) while each entry, split and the account page keep their
 * paise. On unless the user turns it off; remembered on this phone.
 */
const KEY = 'display.round_summaries';

function read(): boolean {
  try {
    return SecureStore.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

let on = read();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function roundSummaries(): boolean {
  return on;
}

/** The setting, kept current for the Settings switch. */
export function useRoundSummaries(): boolean {
  return useSyncExternalStore(subscribe, roundSummaries);
}

export function setRoundSummaries(next: boolean): void {
  if (next === on) return;
  on = next;
  try {
    SecureStore.setItem(KEY, next ? 'on' : 'off');
  } catch {
    // Kept for this session only.
  }
  for (const listener of listeners) listener();
  // Screens reload their numbers, so the new format shows without a restart.
  notifyLedgerChange();
}
