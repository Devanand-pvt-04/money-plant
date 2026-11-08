import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { authStorage } from './kv';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in apps/mobile/.env');
}

/** Where supabase-js keeps the session: its default key for this project. */
export const AUTH_STORAGE_KEY = `sb-${url.replace(/^https?:\/\//, '').split('.')[0]}-auth-token`;

/** Sign-in calls (a token refresh on opening the app) give up after this long instead of holding the first screen. */
const AUTH_TIMEOUT_MS = 15_000;

/**
 * fetch for supabase-js. On a poor connection a token refresh can hang for
 * minutes, and the app waits for it before showing anything; auth calls are
 * cut off after AUTH_TIMEOUT_MS, so supabase-js keeps the stored session and
 * tries again later. Other calls (sync, edge functions) keep their own pace.
 */
const fetchWithAuthTimeout: typeof fetch = (input, init) => {
  const target = typeof input === 'string' ? input : 'url' in input ? input.url : String(input);
  if (!target.includes('/auth/v1/') || init?.signal) return fetch(input, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(url, anonKey, {
  global: { fetch: fetchWithAuthTimeout },
  auth: {
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
