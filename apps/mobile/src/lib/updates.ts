import { DevSettings } from 'react-native';
import * as Updates from 'expo-updates';
import { formatDay, formatTime } from '@/components/format';
import { passUnlockToRestart } from './lock-pass';
import { noteRestart } from './restart-log';
import { restartScreenColor } from './theme';

/** Over-the-air updates only run in release builds that have expo-updates turned on. */
export const updatesOn = Updates.isEnabled && !__DEV__;

/** A check on opening or returning to the app at most this often; Settings always checks. */
const CHECK_EVERY_MS = 15 * 60_000;
let lastCheck = 0;
let running: Promise<UpdateCheck> | null = null;

export type UpdateCheck = 'ready' | 'latest' | 'off' | 'failed';

/**
 * Downloads the newest update for this build's channel and version, if there
 * is one. A downloaded update runs after a restart; useUpdates() then reports
 * it as pending, which shows the restart banner. Concurrent calls share one run.
 */
export function fetchLatestUpdate(force = false): Promise<UpdateCheck> {
  if (!updatesOn) return Promise.resolve('off');
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return Promise.resolve('latest');
  running ??= (async (): Promise<UpdateCheck> => {
    lastCheck = Date.now();
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return 'latest';
      // The server has a newer update than the one running. isNew is false when it
      // was already downloaded (by the check on opening, say): it still needs a restart.
      await Updates.fetchUpdateAsync();
      return 'ready';
    } catch {
      return 'failed';
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Restarts the app on the downloaded update. */
export function restartToUpdate(): Promise<void> {
  passUnlockToRestart();
  noteRestart('update');
  // The reload screen is white unless told otherwise.
  return Updates.reloadAsync({ reloadScreenOptions: { backgroundColor: restartScreenColor(), fade: true, spinner: { enabled: false } } });
}

/** Restarts the JavaScript on whatever update is newest, for a start that seems stuck. */
export function restartApp(): Promise<void> {
  if (__DEV__ || !Updates.isEnabled) {
    DevSettings.reload();
    return Promise.resolve();
  }
  noteRestart('try-again');
  return Updates.reloadAsync({ reloadScreenOptions: { backgroundColor: restartScreenColor(), spinner: { enabled: true } } });
}

/** What is running, for Settings: "0.8.0 · production · updated Mon, 3 Nov, 10:30 am". */
export function runningVersion(): string {
  const parts = [Updates.runtimeVersion ?? 'dev'];
  if (Updates.channel) parts.push(Updates.channel);
  if (Updates.isEmbeddedLaunch || !Updates.createdAt) parts.push('as installed');
  else parts.push(`updated ${formatDay(Updates.createdAt.toISOString())}, ${formatTime(Updates.createdAt.toISOString())}`);
  return parts.join(' · ');
}
