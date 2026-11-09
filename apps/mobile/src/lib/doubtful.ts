import { useSyncExternalStore } from 'react';
import { notifyLedgerChange } from './events';
import { supabase } from './supabase';

/**
 * NW-1: people whose debt to the user is left out of net worth, for loans the
 * user doubts will come back. Kept in the Supabase user's metadata next to the
 * home currency, so every device has it and no table or migration is needed,
 * and read from the stored session, so it works offline.
 */

const KEY = 'doubtful_people';
let current: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

/** The people left out right now. */
export function doubtfulPeople(): ReadonlySet<string> {
  return current;
}

/** Takes the list from the signed-in user's metadata. */
export function applyDoubtfulPeople(metadata: unknown): void {
  const value = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>)[KEY] : undefined;
  const next = new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  if (next.size === current.size && [...next].every((id) => current.has(id))) return;
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

/** Re-renders when the list changes. */
export function useDoubtfulPeople(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, doubtfulPeople, doubtfulPeople);
}

/** Needs the network: the metadata lives on the server. */
export async function setDoubtful(personId: string, doubtful: boolean): Promise<void> {
  const next = new Set(current);
  if (doubtful) next.add(personId);
  else next.delete(personId);
  const { error } = await supabase.auth.updateUser({ data: { [KEY]: [...next] } });
  if (error) throw error;
  applyDoubtfulPeople({ [KEY]: [...next] });
}
