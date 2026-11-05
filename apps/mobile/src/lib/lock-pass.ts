import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Back from the background after this long, the app locks again. Paying in a
 * UPI app or picking a file usually takes less.
 */
export const LOCK_AFTER_MS = 60_000;

/** A restart the app makes itself (a theme change, an update) carries the unlock over for this long. */
const PASS_MS = 15_000;
const KEY = 'lock.restart_pass';

// Kept here, outside React, so a restart decided in the same moment the app
// comes back sees the lock as due before the lock screen has drawn.
let unlocked = false;
let backgroundAt: number | null = null;

AppState.addEventListener('change', (state) => {
  if (state === 'background') backgroundAt ??= Date.now();
  else if (state === 'active') {
    if (backgroundAt !== null && Date.now() - backgroundAt >= LOCK_AFTER_MS) unlocked = false;
    backgroundAt = null;
  }
});

/** The lock screen reports here whether the app is open and unlocked right now. */
export function setUnlocked(value: boolean): void {
  unlocked = value;
}

/**
 * Called just before the app restarts its own JavaScript. If the app is
 * unlocked and not due to lock, the restarted app opens without asking again.
 */
export function passUnlockToRestart(): void {
  const due = backgroundAt !== null && Date.now() - backgroundAt >= LOCK_AFTER_MS;
  if (!unlocked || due) return;
  try {
    SecureStore.setItem(KEY, String(Date.now()));
  } catch {
    // Without the pass the restarted app simply asks again.
  }
}

/** Whether this start follows a restart made from an unlocked app a moment ago. Works once. */
export function takeRestartPass(): boolean {
  try {
    const value = SecureStore.getItem(KEY);
    if (value === null) return false;
    SecureStore.deleteItemAsync(KEY).catch(() => {});
    const age = Date.now() - Number(value);
    return age >= 0 && age < PASS_MS;
  } catch {
    return false;
  }
}
