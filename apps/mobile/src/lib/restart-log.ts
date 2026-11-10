import * as SecureStore from 'expo-secure-store';

/**
 * The app restarts its own JavaScript for a theme change, an update or "Try
 * again". Each restart is noted here just before it happens, so the next start
 * knows why it began and how many restarts came one after another. Kept in
 * SecureStore (synchronous, no database) because it is read before anything
 * else has loaded.
 */
export type RestartReason = 'theme-choice' | 'theme-system' | 'update' | 'try-again';

interface RestartNote {
  at: number;
  reason: RestartReason;
  /** Restarts in a row, each within RUN_MS of the one before. */
  count: number;
}

const KEY = 'restart.last';
/** Restarts closer together than this count as one run. */
const RUN_MS = 60_000;

function read(): RestartNote | null {
  try {
    const value = SecureStore.getItem(KEY);
    if (!value) return null;
    const note = JSON.parse(value) as RestartNote;
    return typeof note.at === 'number' && typeof note.count === 'number' ? note : null;
  } catch {
    return null;
  }
}

/** When this JavaScript started. */
export const startedAt = Date.now();

/** The restart that started this run, if it happened a moment ago. */
const previous = (() => {
  const note = read();
  if (!note) return null;
  const age = startedAt - note.at;
  return age >= 0 && age < RUN_MS ? note : null;
})();

/** Notes a restart the app is about to make. */
export function noteRestart(reason: RestartReason): void {
  try {
    const count = previous && Date.now() - previous.at < RUN_MS * 2 ? previous.count + 1 : 1;
    SecureStore.setItem(KEY, JSON.stringify({ at: Date.now(), reason, count } satisfies RestartNote));
  } catch {
    // Without the note the next start simply doesn't know why it began.
  }
}

/** Why this run started, when it began with a restart the app made a moment ago. */
export function startedFromRestart(): RestartNote | null {
  return previous;
}
