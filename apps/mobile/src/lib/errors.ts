import { eq } from 'drizzle-orm';
import * as Crypto from 'expo-crypto';
import * as Updates from 'expo-updates';
import { kv } from '@money-plant/db-schema';
import { openedDb } from './db';
import { supabase } from './supabase';

const QUEUE_KEY = 'errors.pending';
const MAX_QUEUED = 20;

interface ErrorReport {
  id: string;
  message: string;
  stack: string | null;
  source: string;
  fatal: boolean;
  app_version: string | null;
  update_id: string | null;
  channel: string | null;
  occurred_at: string;
}

/** Digits that could be an amount, an account or a phone number never leave the phone, in errors either. */
function scrub(text: string, max: number): string {
  return text.replace(/\d[\d,.]{3,}/g, '#').slice(0, max);
}

function readQueue(): ErrorReport[] {
  const db = openedDb();
  if (!db) return [];
  try {
    const row = db.select().from(kv).where(eq(kv.key, QUEUE_KEY)).get();
    return row ? (JSON.parse(row.value) as ErrorReport[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: ErrorReport[]): void {
  const db = openedDb();
  if (!db) return;
  const value = JSON.stringify(queue.slice(-MAX_QUEUED));
  db.insert(kv).values({ key: QUEUE_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value } }).run();
}

/** Supabase hands back plain objects with a message and a code; keep both rather than "[object Object]". */
function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    const { message, code } = error as { message: string; code?: unknown };
    const e = new Error(typeof code === 'string' && code ? `${code} ${message}` : message);
    e.name = 'ServerError';
    return e;
  }
  return new Error(String(error));
}

/**
 * Records an error for the error log: the message and stack with numbers
 * taken out, where it happened and the app version, never amounts, payees or
 * SMS text. It is queued on the phone at once, synchronously, so a crash
 * that ends the app still leaves it behind, and sent at the next chance.
 */
export function reportError(error: unknown, source: string, fatal = false): void {
  try {
    const e = toError(error);
    const report: ErrorReport = {
      id: Crypto.randomUUID(),
      message: scrub(`${e.name}: ${e.message}`, 500),
      stack: e.stack ? scrub(e.stack, 4000) : null,
      source: source.slice(0, 60),
      fatal,
      app_version: Updates.runtimeVersion ?? null,
      update_id: Updates.updateId ?? null,
      channel: Updates.channel ?? null,
      occurred_at: new Date().toISOString(),
    };
    writeQueue([...readQueue(), report]);
  } catch {
    // Reporting must never throw on its own.
  }
  void flushErrors();
}

let flushing: Promise<void> | null = null;

/** Sends queued errors to the error log. Needs a signed-in session; otherwise they wait. */
export function flushErrors(): Promise<void> {
  flushing ??= (async () => {
    try {
      const queue = readQueue();
      if (queue.length === 0) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const { error } = await supabase.from('app_errors').upsert(queue, { onConflict: 'id', ignoreDuplicates: true });
      if (error) return;
      const sent = new Set(queue.map((r) => r.id));
      writeQueue(readQueue().filter((r) => !sent.has(r.id)));
    } catch {
      // Offline or signed out: try again next time.
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Errors thrown outside a screen (in a handler or a timer) are reported too, then handled as before. */
export function watchErrors(): void {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    reportError(error, 'global', !!isFatal);
    previous(error, isFatal);
  });
}

/** Offline and timed-out calls are expected on a phone; they aren't worth a report. */
function isOffline(error: Error): boolean {
  return /network request failed|failed to fetch|fetch failed|FunctionsFetchError|FunctionsRelayError|AuthRetryableFetchError|timed? ?out|aborted/i.test(
    `${error.name} ${error.message}`,
  );
}

const reported = new Set<string>();

/**
 * A catch handler for work that runs in the background (sync, refresh passes,
 * SMS capture), whose failures would otherwise vanish. It records the error in
 * the error log, once per source and message each time the app runs, and skips
 * offline failures. `withoutMessage` keeps only the error's name and where it
 * was thrown: for capture, where a message could quote the SMS.
 */
export function reportBackground(source: string, options: { withoutMessage?: boolean } = {}): (error: unknown) => void {
  return (error) => {
    const e = toError(error);
    if (isOffline(e)) return;
    const key = `${source}|${e.name}|${options.withoutMessage ? '' : e.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    if (!options.withoutMessage) return reportError(e, source);
    const bare = new Error('(message left out)');
    bare.name = e.name;
    // The first line of a stack repeats the message; keep only the frames.
    bare.stack = e.stack ? `${e.name}\n${e.stack.split('\n').slice(1).join('\n')}` : undefined;
    reportError(bare, source);
  };
}
