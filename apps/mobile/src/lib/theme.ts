import { useSyncExternalStore } from 'react';
import { AppState, Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

const KEY = 'theme.preference';

function readPreference(): ThemePreference {
  try {
    const value = SecureStore.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

let preference = readPreference();
// Native views (alerts, the keyboard, pickers) follow the same choice.
Appearance.setColorScheme(preference === 'system' ? 'auto' : preference);

const current = (): Scheme =>
  preference !== 'system' ? preference : Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';

/** The ground of each scheme. components/ui builds its palette on these. */
export const BACKGROUND: Record<Scheme, string> = { light: '#F3F4F2', dark: '#121413' };

/**
 * The scheme on screen. It changes in place: every component that reads
 * colours or styles through useScheme (components/ui's useColors and
 * makeStyles) draws again, and where the user was is kept. Earlier the app
 * restarted its JavaScript on a change, which flashed a blank screen and went
 * back to Home.
 */
let scheme: Scheme = current();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getScheme(): Scheme {
  return scheme;
}

/** The scheme on screen; the component draws again when it changes. */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribe, getScheme);
}

function emit(): void {
  for (const listener of listeners) listener();
}

function apply(next: Scheme): void {
  if (next === scheme) return;
  scheme = next;
  // The window behind the app, so screen transitions match the new ground.
  SystemUI.setBackgroundColorAsync(BACKGROUND[next]).catch(() => {});
  emit();
}

export function themePreference(): ThemePreference {
  return preference;
}

/** The chosen theme (System, Light or Dark), kept current for the Settings switch. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, themePreference);
}

/** The ground of the scheme on screen, for an update restart's reload screen. */
export function restartScreenColor(): string {
  return BACKGROUND[scheme];
}

export function setThemePreference(next: ThemePreference): void {
  if (next === preference) return;
  preference = next;
  SecureStore.setItem(KEY, next);
  Appearance.setColorScheme(next === 'system' ? 'auto' : next);
  apply(current());
  emit();
  // Back on "system", the phone may report the old override for a moment; look again once it has caught up.
  if (next === 'system') setTimeout(() => apply(current()), 300);
}

/**
 * Follows the phone's setting while the preference is "system", on its change
 * event and whenever the app comes back to the foreground.
 */
export function followSystemScheme(): () => void {
  const check = () => apply(current());
  const appearance = Appearance.addChangeListener(check);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') check();
  });
  check();
  return () => {
    appearance.remove();
    appState.remove();
  };
}
