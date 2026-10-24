import * as Crypto from 'expo-crypto';
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { addDays, addMonthsToDate, dateKey, startOfDate, type DateKey } from '@money-plant/core';
import { captureLog, pendingNotifications, sources, transactions } from '@money-plant/db-schema';
import { ingestNotification, ingestSms, type IngestResult, type PipelineContext } from '@money-plant/matcher';
import {
  BANK_SENDER_TOKENS,
  normaliseSender,
  parseNotification,
  parsePreDebit,
  parseSms,
} from '@money-plant/parser';
import { readInbox, type CaptureTaskData } from '../../modules/sms-reader';
import { categoriseWithAi } from './ai-categorise';
import { checkPaceAlerts } from './budgets';
import { pipelineCategoriser } from './categories';
import { refreshIous } from './ious';
import { applyPreDebitNotice, refreshRecurring } from './recurring';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { ensureBalanceRefs } from './ledger';
import { kvGet, kvSet } from './kv';
import { SqliteLedgerStore } from './ledger-store';
import { supabase } from './supabase';
import { syncNow } from './sync';

const INBOX_CURSOR_KEY = 'capture.sms.cursor';
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
  return { store: await SqliteLedgerStore.open(), newId: () => Crypto.randomUUID(), categorise: await pipelineCategoriser() };
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

  const receivedAt = new Date(message.receivedAt).toISOString();
  // REC-1: an autopay notice is not a payment, but it says one is coming. Notices
  // for dates already past (an old inbox) are skipped; detection covers history.
  const notice = parsePreDebit({ sender: message.sender, body: message.body }, new Date());
  if (notice) {
    await applyPreDebitNotice(notice);
    db.insert(captureLog)
      .values({ fingerprint, channel: 'sms', sender, receivedAt, status: 'ignored', reason: 'pre_debit', rawText: null })
      .onConflictDoNothing()
      .run();
    return null;
  }

  const result = parseSms({ sender: message.sender, body: message.body });
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

/** CAP-2: how far back the first import reads unless the user picks another range. */
export const DEFAULT_IMPORT_MONTHS = 6;

/**
 * Runs inbox scans one at a time. `scan` reads bank SMS received after
 * `from` (milliseconds), oldest first, and stops after `until` when given.
 * Already-seen messages are skipped by fingerprint, so any range can be read
 * again without making duplicates.
 */
function runImport(
  from: (cursor: number | null) => number,
  until: number | null,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportProgress> {
  const run = (importing ?? Promise.resolve(null)).catch(() => null).then(async () => {
    const stored = await kvGet(INBOX_CURSOR_KEY);
    if (stored === null) {
      // Pull what other devices already synced first, so this phone doesn't re-create those entries.
      await syncNow().catch(() => {});
    }
    await ensureBalanceRefs();
    let since = from(stored === null ? null : Number(stored));
    let newest = stored === null ? 0 : Number(stored);
    const progress: ImportProgress = { read: 0, created: 0, merged: 0 };
    for (let done = false; !done; ) {
      const page = await readInbox(since, BANK_SENDER_TOKENS, PAGE_SIZE);
      for (const message of page) {
        if (until !== null && message.receivedAt > until) {
          done = true;
          break;
        }
        const outcome = await captureSms(message);
        progress.read++;
        if (outcome?.outcome === 'created') progress.created++;
        if (outcome?.outcome === 'attached' || outcome?.outcome === 'transfer') progress.merged++;
        since = Math.max(since, message.receivedAt);
        newest = Math.max(newest, message.receivedAt);
      }
      // The catch-up cursor only moves forward; a range in the past leaves it where it was.
      if (newest > 0) await kvSet(INBOX_CURSOR_KEY, String(newest));
      onProgress?.({ ...progress });
      if (page.length < PAGE_SIZE) done = true;
    }
    // After the first import, catch-up starts where the picked range ends, even when it found nothing.
    if (stored === null) await kvSet(INBOX_CURSOR_KEY, String(Math.max(newest, Math.min(until ?? Date.now(), Date.now()))));
    if (progress.read > 0) {
      await refreshRecurring().catch(() => {});
      await refreshIous().catch(() => {});
      notifyLedgerChange();
    }
    return progress;
  });
  importing = run;
  run.finally(() => {
    if (importing === run) importing = null;
  }).catch(() => {});
  return run;
}

/**
 * Catch-up: reads bank SMS newer than the last one processed, which is
 * whatever arrived while the receiver couldn't run. Before the first import
 * it reads the default 6 months.
 */
export function importInbox(onProgress?: (progress: ImportProgress) => void): Promise<ImportProgress> {
  return runImport((cursor) => cursor ?? startOfDate(addMonthsToDate(dateKey(new Date()), -DEFAULT_IMPORT_MONTHS)).getTime(), null, onProgress);
}

/**
 * CAP-2: reads bank SMS from a range the user picked, from the start of
 * `from` to the end of `to` (both dates on the phone's calendar). Messages
 * already read are skipped, so importing a range again is safe.
 */
export function importRange(from: DateKey, to: DateKey, onProgress?: (progress: ImportProgress) => void): Promise<ImportProgress> {
  const until = startOfDate(addDays(to, 1)).getTime() - 1;
  return runImport(() => startOfDate(from).getTime() - 1, until, onProgress);
}

export async function hasImportedInbox(): Promise<boolean> {
  return (await kvGet(INBOX_CURSOR_KEY)) !== null;
}

/** Bump when a parser change can find payees it missed before, so entries get them on the next start. */
const PAYEE_PASS = '1';
const PAYEE_PASS_KEY = 'capture.payees.pass';

/**
 * Re-reads the stored SMS of entries with no payee once per parser change,
 * and fills in the payee it now finds (for example ICICI autopay debits).
 * A payee the user typed is never replaced. Runs on the phone; the text
 * never leaves it.
 */
export async function fillMissingPayees(): Promise<number> {
  if ((await kvGet(PAYEE_PASS_KEY)) === PAYEE_PASS) return 0;
  const db = await getDb();
  const rows = db
    .select({ id: transactions.id, userSetFields: transactions.userSetFields, sender: sources.sender, rawText: sources.rawText })
    .from(transactions)
    .innerJoin(sources, eq(sources.transactionId, transactions.id))
    .where(and(isNull(transactions.deletedAt), isNull(transactions.counterparty), eq(sources.kind, 'sms'), isNotNull(sources.rawText)))
    .all();
  let filled = 0;
  for (const row of rows) {
    if ((JSON.parse(row.userSetFields) as string[]).includes('counterparty')) continue;
    const result = parseSms({ sender: row.sender ?? '', body: row.rawText! });
    if (result.status !== 'parsed' || !result.transaction.counterparty) continue;
    db.update(transactions)
      .set({ counterparty: result.transaction.counterparty, dirty: 1, rev: sql`${transactions.rev} + 1` })
      .where(and(eq(transactions.id, row.id), isNull(transactions.counterparty)))
      .run();
    filled++;
  }
  await kvSet(PAYEE_PASS_KEY, PAYEE_PASS);
  if (filled > 0) notifyLedgerChange();
  return filled;
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
    await checkPaceAlerts().catch(() => {});
    await refreshRecurring().catch(() => {});
    await refreshIous().catch(() => {});
    await syncNow();
    await categoriseWithAi();
  } catch (e) {
    // Keep message contents out of logs.
    console.warn('Capture task failed:', e instanceof Error ? e.name : 'unknown error');
  }
}
