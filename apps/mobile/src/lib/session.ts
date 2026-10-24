import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { wipeLocal } from './wipe';

/** Current auth session; `loading` is true until the stored session has been read. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
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
