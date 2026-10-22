import * as Crypto from 'expo-crypto';
import { eq, lt } from 'drizzle-orm';
import { captureLog, pendingNotifications } from '@money-plant/db-schema';
import { ingestNotification, ingestSms, type IngestResult, type PipelineContext } from '@money-plant/matcher';
import {
  BANK_SENDER_TOKENS,
  normaliseSender,
  parseNotification,
  parseSms,
} from '@money-plant/parser';
import { readInbox, type CaptureTaskData } from '../../modules/sms-reader';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { ensureBalanceRefs } from './ledger';
import { kvGet, kvSet } from './kv';
import { SqliteLedgerStore } from './ledger-store';
import { supabase } from './supabase';
import { syncNow } from './sync';

const INBOX_CURSOR_KEY = 'capture.sms.cursor';
/** CAP-2: the first run reads about 6 months of bank SMS. */
const FIRST_IMPORT_DAYS = 183;
const PAGE_SIZE = 300;
const DAY = 24 * 60 * 60 * 1000;

export interface SmsMessage {
  sender: string;
  body: string;
  receivedAt: number;
  sentAt: number;
}

// ---- One message at a time ----

// The receiver, the notification listener and the inbox scan can all fire at
// once; running captures one after another keeps matching deterministic.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

async function context(): Promise<PipelineContext> {
  return { store: await SqliteLedgerStore.open(), newId: () => Crypto.randomUUID() };
}

async function fingerprintOf(...parts: (string | number)[]): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, parts.join('|'));
}

/**
 * Runs one bank SMS through the pipeline. The text stays on the phone: only
 * the parsed fields are written to rows that sync. Failures keep the text in
 * the local capture log so the user can see what the parser missed (CAP-8).
 */
async function captureSmsNow(message: SmsMessage): Promise<IngestResult | null> {
  const sender = normaliseSender(message.sender);
  const fingerprint = await fingerprintOf('sms', sender, message.sentAt, message.body);
  const db = await getDb();
  const logged = db.select({ status: captureLog.status }).from(captureLog).where(eq(captureLog.fingerprint, fingerprint)).get();
  if (logged) return null;

  const result = parseSms({ sender: message.sender, body: message.body });
  const receivedAt = new Date(message.receivedAt).toISOString();
  if (result.status === 'ignored' && result.reason === 'unknown_sender') return null;

  let outcome: IngestResult | null = null;
  if (result.status === 'parsed') {
    outcome = await ingestSms(await context(), {
      parsed: result.transaction,
      sender,
      receivedAt,
      fingerprint,
      rawText: message.body,
    });
  }
  db.insert(captureLog)
    .values({
      fingerprint,
      channel: 'sms',
      sender,
      receivedAt,
      status: result.status,
      reason: result.status === 'parsed' ? result.transaction.template : result.reason,
      rawText: result.status === 'failed' ? message.body : null,
    })
    .onConflictDoNothing()
    .run();
  return outcome;
}

export function captureSms(message: SmsMessage): Promise<IngestResult | null> {
  return serial(() => captureSmsNow(message));
}

export function captureNotification(input: { packageName: string; title: string; text: string; receivedAt: number }) {
  return serial(async () => {
    const parsed = parseNotification(input);
    if (!parsed) return null;
    const fingerprint = await fingerprintOf('notification', input.packageName, input.receivedAt, input.title, input.text);
    const result = await ingestNotification(await context(), {
      parsed,
      receivedAt: new Date(input.receivedAt).toISOString(),
      fingerprint,
    });
    // Notifications whose SMS never came (wallet payments, failed UPI) expire after a day.
    const db = await getDb();
    db.delete(pendingNotifications).where(lt(pendingNotifications.receivedAt, new Date(Date.now() - DAY).toISOString())).run();
    return result;
  });
}

// ---- Inbox import and catch-up (CAP-2) ----

export interface ImportProgress {
  read: number;
  created: number;
  merged: number;
}

let importing: Promise<ImportProgress> | null = null;

/**
 * Reads bank SMS newer than the last one processed: 6 months back on first run,
 * otherwise whatever arrived while the receiver couldn't run. Already-seen
 * messages are skipped by fingerprint, so running this often is safe.
 */
export function importInbox(onProgress?: (progress: ImportProgress) => void): Promise<ImportProgress> {
  importing ??= (async () => {
    try {
      const firstRun = (await kvGet(INBOX_CURSOR_KEY)) === null;
      if (firstRun) {
        // Pull what other devices already synced first, so this phone doesn't re-create those entries.
        await syncNow().catch(() => {});
      }
      await ensureBalanceRefs();
      let cursor = Number((await kvGet(INBOX_CURSOR_KEY)) ?? Date.now() - FIRST_IMPORT_DAYS * DAY);
      const progress: ImportProgress = { read: 0, created: 0, merged: 0 };
      for (;;) {
        const page = await readInbox(cursor, BANK_SENDER_TOKENS, PAGE_SIZE);
        for (const message of page) {
          const outcome = await captureSms(message);
          progress.read++;
          if (outcome?.outcome === 'created') progress.created++;
          if (outcome?.outcome === 'attached' || outcome?.outcome === 'transfer') progress.merged++;
          cursor = Math.max(cursor, message.receivedAt);
        }
        await kvSet(INBOX_CURSOR_KEY, String(cursor));
        onProgress?.({ ...progress });
        if (page.length < PAGE_SIZE) break;
      }
      if (progress.read > 0) notifyLedgerChange();
      return progress;
    } finally {
      importing = null;
    }
  })();
  return importing;
}

export async function hasImportedInbox(): Promise<boolean> {
  return (await kvGet(INBOX_CURSOR_KEY)) !== null;
}

/** Re-parses messages that failed before, for example after a parser update. */
export async function retryFailedMessages(): Promise<number> {
  const db = await getDb();
  const failed = db.select().from(captureLog).where(eq(captureLog.status, 'failed')).all();
  let fixed = 0;
  for (const row of failed) {
    if (!row.rawText) continue;
    const result = parseSms({ sender: row.sender, body: row.rawText });
    if (result.status === 'failed') continue;
    db.delete(captureLog).where(eq(captureLog.fingerprint, row.fingerprint)).run();
    if (result.status === 'parsed') {
      const rawText = row.rawText;
      await serial(async () =>
        ingestSms(await context(), { parsed: result.transaction, sender: row.sender, receivedAt: row.receivedAt, fingerprint: row.fingerprint, rawText }),
      );
    }
    db.insert(captureLog)
      .values({
        fingerprint: row.fingerprint,
        channel: 'sms',
        sender: row.sender,
        receivedAt: row.receivedAt,
        status: result.status,
        reason: result.status === 'parsed' ? result.transaction.template : result.reason,
        rawText: null,
      })
      .onConflictDoNothing()
      .run();
    fixed++;
  }
  if (fixed > 0) notifyLedgerChange();
  return fixed;
}

// ---- Headless task ----

/**
 * Entry point for the native receiver and notification listener. Runs with or
 * without the app on screen. Does nothing when nobody is signed in: the next
 * sign-in imports the inbox from scratch.
 */
export async function runCaptureTask(data: CaptureTaskData): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return;
  try {
    await ensureBalanceRefs();
    if (data.kind === 'sms') {
      await captureSms({ sender: data.sender, body: data.body, receivedAt: data.receivedAt, sentAt: data.sentAt });
    } else {
      await captureNotification(data);
    }
    notifyLedgerChange();
    await syncNow();
  } catch (e) {
    // Keep message contents out of logs.
    console.warn('Capture task failed:', e instanceof Error ? e.name : 'unknown error');
  }
}
