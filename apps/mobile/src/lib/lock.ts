import * as LocalAuthentication from 'expo-local-authentication';
import { kvGet, kvSet } from './kv';

const LOCK_KEY = 'lock.enabled';

/** Back from the background after this long, the app locks again. Paying in a UPI app or picking a file usually takes less. */
export const LOCK_AFTER_MS = 60_000;

/** ACC-2: the lock is on unless the user turned it off. */
export async function lockEnabled(): Promise<boolean> {
  return (await kvGet(LOCK_KEY)) !== 'off';
}

export async function setLockEnabled(on: boolean): Promise<void> {
  await kvSet(LOCK_KEY, on ? 'on' : 'off');
}

/** Whether the phone has a fingerprint, face or screen lock to unlock with. Without one the app can't lock. */
export async function lockAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

export type UnlockResult = 'unlocked' | 'cancelled' | 'unavailable' | 'failed';

/** Asks for the fingerprint or face, with the phone's own PIN, pattern or password as the fallback. */
export async function unlock(promptMessage = 'Unlock Money Plant'): Promise<UnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: 'Cancel' });
    if (result.success) return 'unlocked';
    if (result.error === 'not_enrolled' || result.error === 'not_available' || result.error === 'passcode_not_set') return 'unavailable';
    if (result.error === 'user_cancel' || result.error === 'system_cancel' || result.error === 'app_cancel') return 'cancelled';
    return 'failed';
  } catch {
    return 'failed';
  }
}
