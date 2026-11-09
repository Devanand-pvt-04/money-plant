import { useEffect, useState } from 'react';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { applyDoubtfulPeople } from './doubtful';
import { applyHomeCurrency } from './home-currency';
import { authStorage } from './kv';
import { AUTH_STORAGE_KEY, supabase } from './supabase';
import { wipeLocal } from './wipe';

/** The session supabase-js keeps on the phone, read as stored, even if its access token has expired. */
async function storedSession(): Promise<Session | null> {
  try {
    const raw = await authStorage.getItem(AUTH_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const session = parsed as Partial<Session>;
    return session.access_token && session.refresh_token && session.user?.id ? (session as Session) : null;
  } catch {
    return null;
  }
}

/** Current auth session; `loading` is true until the stored session has been read. */
export function useSession() {
  const [session, setStoredSession] = useState<Session | null>(null);
  // The home currency (ACC-11) and doubtful loans (NW-1) ride along in the user's metadata.
  const setSession = (next: Session | null) => {
    applyHomeCurrency(next?.user?.user_metadata);
    applyDoubtfulPeople(next?.user?.user_metadata);
    setStoredSession(next);
  };
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(
      async ({ data, error }) => {
        // Offline, or a refresh that timed out: the ledger lives on the phone, so open with the
        // stored session instead of the sign-in screen. Sync refreshes the token once it can.
        setSession(data.session ?? (error && isAuthRetryableFetchError(error) ? await storedSession() : null));
        setLoading(false);
      },
      async () => {
        setSession(await storedSession());
        setLoading(false);
      },
    );
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

/** Signs out and wipes this phone's copy, so the next person to sign in starts clean. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  await wipeLocal({ keepSession: false });
}
