import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Whether the signed-in user is the server's admin (the `admin` role in app
 * metadata, decision 0016). Used for wording only, such as "your PC" in
 * place of "Deva's PC", and to keep developer tools out of friends' Settings
 * (decision 0028). Never a security check: the server enforces access.
 */
export function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let live = true;
    supabase.auth
      .getSession()
      .then(({ data }) => live && setAdmin(data.session?.user.app_metadata?.role === 'admin'))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return admin;
}
