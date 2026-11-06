import { useEffect, useState } from 'react';
import { kvGet, kvSet } from './kv';

/** Bumped when what the consent screen says changes, so it is shown again. */
// v2: AI now runs (decision 0012), so everyone reads the AI point once more.
// v3: the point on what Deva, who runs the server, can see (decision 0016).
const CONSENT_KEY = 'consent.v3';
const EARLIER_KEYS = ['consent.v2', 'consent.v1'];

const listeners = new Set<(given: boolean) => void>();

/** ACC-5: whether this user agreed to the consent screen on this phone. null while it is read. */
export function useConsent(userId: string | undefined): boolean | null {
  const [given, setGiven] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) {
      setGiven(null);
      return;
    }
    let live = true;
    kvGet(CONSENT_KEY)
      .then((value) => live && setGiven(value !== null))
      .catch(() => live && setGiven(false));
    listeners.add(setGiven);
    return () => {
      live = false;
      listeners.delete(setGiven);
    };
  }, [userId]);

  return given;
}

export async function giveConsent(): Promise<void> {
  await kvSet(CONSENT_KEY, new Date().toISOString());
  for (const listener of listeners) listener(true);
}

/** True when this user agreed to an earlier version on this phone: they see only the new consent, not the whole first run. */
export async function agreedBefore(): Promise<boolean> {
  for (const key of EARLIER_KEYS) if ((await kvGet(key)) !== null) return true;
  return false;
}
