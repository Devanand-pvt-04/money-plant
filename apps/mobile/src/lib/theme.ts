import { AppState, Appearance, DevSettings } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';

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

/**
 * The scheme for this run of the app, fixed at start. Styles are built once
 * with plain StyleSheet objects, so a change of theme restarts the JS instead
 * of re-rendering every screen: a rare event, and screens stay as fast as before.
 */
export const scheme: Scheme = current();

export function themePreference(): ThemePreference {
  return preference;
}

function restart() {
  if (__DEV__) DevSettings.reload();
  else Updates.reloadAsync().catch(() => {});
}

export function setThemePreference(next: ThemePreference): void {
  if (next === preference) return;
  preference = next;
  SecureStore.setItem(KEY, next);
  Appearance.setColorScheme(next === 'system' ? 'auto' : next);
  // Always restart: right after the override changes, the phone may still report the old scheme.
  restart();
}

/**
 * Follows the phone's setting while the preference is "system": the app
 * restarts on the change, or when it next comes to the foreground.
 */
export function followSystemScheme(): () => void {
  const check = () => {
    if (AppState.currentState === 'active' && current() !== scheme) restart();
  };
  const appearance = Appearance.addChangeListener(check);
  const appState = AppState.addEventListener('change', check);
  return () => {
    appearance.remove();
    appState.remove();
  };
}
