import * as Crypto from 'expo-crypto';
import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { addDays, addMonthsToDate, convertOn, dateKey, DEFAULT_CURRENCY, paise, startOfDate, type CurrencyCode, type DateKey } from '@money-plant/core';
import { accounts, captureLog, pendingNotifications, sources, transactions } from '@money-plant/db-schema';
import { ingestNotification, ingestSms, type IngestResult, type PipelineContext } from '@money-plant/matcher';
import {
  BANK_SENDER_TOKENS,
  normaliseSender,
  parseNotification,
  parsePreDebit,
  identifyBankSender,
  parseAnySms,
  parseBankText,
  parseSms,
  UPI_APP_PACKAGES,
  type ParsedTransaction,
} from '@money-plant/parser';
import { readInbox, type CaptureTaskData } from '../../modules/sms-reader';
import { categoriseWithAi } from './ai-categorise';
import { checkPaceAlerts } from './budgets';
import { pipelineCategoriser } from './categories';
import { refreshIous } from './ious';
import { applyPreDebitNotice, refreshRecurring } from './recurring';
import { getDb } from './db';
import { reportBackground } from './errors';
import { notifyLedgerChange } from './events';
import { ensureBalanceRefs } from './ledger';
import { loadRates, requestRates } from './fx';
import { localDay } from './home-money';
import { kvGet, kvSet } from './kv';
import { appChoices, appSender, noteAppCandidate, senderChoices, setSenderReplay, syncCaptureFilters } from './senders';
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
 * The amount in the account's currency (CAP-10, CAP-11). An Indian bank SMS
 * with a foreign amount ("USD 25.00 spent on your card") becomes rupees at
 * that day's rate, with what the message said kept beside it; the statement
 * later replaces the estimate. A linked sender's amounts become its
 * account's currency the same way. A message without a currency is in
 * `fallback`. Null while no rate is known (offline): the message waits with
 * the failed ones and is read again on the next retry.
 */
async function inCurrency(parsed: ParsedTransaction, receivedAt: string, target: CurrencyCode, fallback: CurrencyCode): Promise<ParsedTransaction | null> {
  const { currency: given, ...rest } = parsed;
  const currency = given ?? fallback;
  if (currency === target) return rest;
  const day = localDay(receivedAt);
  const wanted = [currency, target];
  let rates = await loadRates(wanted);
  const known = (c: CurrencyCode) => c === DEFAULT_CURRENCY || rates.some((r) => r.currency === c && r.date === day);
  if (!wanted.every(known) && (await requestRates(wanted, [day]).catch(() => false))) rates = await loadRates(wanted);
  const amount = convertOn(rates, parsed.amount, currency, target, day);
  if (amount === null) return null;
  return { ...rest, amount: paise(amount), foreign: { amount: parsed.amount, currency } };
}

/** A message to read: an SMS, or the text of a notification from an app the user approved (CAP-12). */
interface IncomingMessage {
  /** The capture log's sender: the normalised SMS header, or appSender(package). */
  key: string;
  channel: 'sms' | 'notification';
  /** The SMS sender as the phone stores it; null for an app. */
  address: string | null;
  body: string;
  receivedAt: string;
  fingerprint: string;
}

function logCapture(db: Awaited<ReturnType<typeof getDb>>, message: IncomingMessage, status: 'parsed' | 'ignored' | 'failed' | 'waiting', reason: string | null) {
  db.insert(captureLog)
    .values({
      fingerprint: message.fingerprint,
      channel: message.channel,
      sender: message.key,
      receivedAt: message.receivedAt,
      status,
      reason,
      // Kept on this phone only, so failed and waiting messages can be read again or shared anonymised (CAP-8, CAP-9).
      rawText: status === 'failed' || status === 'waiting' ? message.body : null,
    })
    .onConflictDoNothing()
    .run();
}

/**
 * Reads one message into the ledger. Known banks use their tuned rules and
 * find the account from the message. Any other business sender (CAP-11)
 * goes through the general reader and waits, unread into the ledger, until
 * the user links it to an account in Review; then it posts there.
 */
async function readMessage(message: IncomingMessage): Promise<IngestResult | null> {
  const db = await getDb();
  const tuned = message.address !== null && identifyBankSender(message.address) !== null;
  const result = message.address !== null ? parseAnySms({ sender: message.address, body: message.body }) : parseBankText(null, message.body);
  if (result.status === 'ignored' && result.reason === 'unknown_sender') return null;

  let accountId: string | undefined;
  let target: CurrencyCode = DEFAULT_CURRENCY;
  if (!tuned) {
    const choice = (await senderChoices())[message.key];
    if (choice && 'ignored' in choice) {
      logCapture(db, message, 'ignored', 'ignored_sender');
      return null;
    }
    if (!choice) {
      // Asked about in Review: "New sender: ENBD. Which account is this?"
      if (result.status === 'ignored') logCapture(db, message, 'ignored', result.reason);
      else logCapture(db, message, 'waiting', 'new_sender');
      return null;
    }
    const account = db.select({ id: accounts.id, currency: accounts.currency }).from(accounts).where(eq(accounts.id, choice.accountId)).get();
    if (!account) {
      logCapture(db, message, 'waiting', 'new_sender');
      return null;
    }
    accountId = account.id;
    target = account.currency;
  }

  if (result.status !== 'parsed') {
    logCapture(db, message, result.status, result.reason);
    return null;
  }
  // Indian banks write rupees unless they say otherwise; a linked sender, its account's currency.
  const converted = await inCurrency(result.transaction, message.receivedAt, target, target);
  if (!converted) {
    logCapture(db, message, 'failed', 'no_rate');
    return null;
  }
  const outcome = await ingestSms(await context(), {
    parsed: converted,
    sender: message.key,
    receivedAt: message.receivedAt,
    fingerprint: message.fingerprint,
    rawText: message.body,
    ...(accountId ? { accountId } : {}),
  });
  logCapture(db, message, 'parsed', result.transaction.template);
  return outcome;
}

/**
 * Runs one SMS through the pipeline. The text stays on the phone: only
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
  return readMessage({ key: sender, channel: 'sms', address: message.sender, body: message.body, receivedAt, fingerprint });
}

/** Reads the messages that waited for a sender the user just linked (CAP-11). */
async function replaySender(sender: string): Promise<number> {
  const db = await getDb();
  const rows = db
    .select()
    .from(captureLog)
    .where(and(eq(captureLog.sender, sender), eq(captureLog.status, 'waiting')))
    .orderBy(asc(captureLog.receivedAt))
    .all();
  let read = 0;
  for (const row of rows) {
    if (!row.rawText) continue;
    const body = row.rawText;
    db.delete(captureLog).where(eq(captureLog.fingerprint, row.fingerprint)).run();
    const outcome = await serial(() =>
      readMessage({
        key: row.sender,
        channel: row.channel,
        address: row.channel === 'sms' ? row.sender : null,
        body,
        receivedAt: row.receivedAt,
        fingerprint: row.fingerprint,
      }),
    );
    if (outcome) read++;
  }
  if (read > 0) {
    await refreshRecurring().catch(reportBackground('recurring'));
    notifyLedgerChange();
  }
  return read;
}
setSenderReplay(replaySender);

export function captureSms(message: SmsMessage): Promise<IngestResult | null> {
  return serial(() => captureSmsNow(message));
}

export function captureNotification(input: { packageName: string; title: string; text: string; receivedAt: number }) {
  return serial(async () => {
    if (!UPI_APP_PACKAGES[input.packageName]) {
      // CAP-12: an app the user approved. Read like a business SMS, under the app's name.
      const body = `${input.title}\n${input.text}`.trim();
      const fingerprint = await fingerprintOf('notification', input.packageName, input.receivedAt, input.title, input.text);
      const db = await getDb();
      if (db.select({ status: captureLog.status }).from(captureLog).where(eq(captureLog.fingerprint, fingerprint)).get()) return null;
      const apps = await appChoices();
      if (apps[input.packageName]?.state !== 'approved') return null;
      await readMessage({ key: appSender(input.packageName), channel: 'notification', address: null, body, receivedAt: new Date(input.receivedAt).toISOString(), fingerprint });
      return null;
    }
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
    // The receiver's copy of ignored senders and approved apps is lost when Android clears app data.
    await syncCaptureFilters().catch(reportBackground('capture-filters'));
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
      await refreshRecurring().catch(reportBackground('recurring'));
      await refreshIous().catch(reportBackground('ious'));
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
  if ((await kvGet(INBOX_CURSOR_KEY)) !== null) return true;
  // The cursor goes when the phone's data is cleared, but bank SMS read live since then still
  // count: start catch-up from the newest one instead of asking for a first import again.
  const db = await getDb();
  const newest = db
    .select({ at: sql<string | null>`max(${sources.receivedAt})` })
    .from(sources)
    .where(eq(sources.kind, 'sms'))
    .get()?.at;
  const millis = newest ? Date.parse(newest) : NaN;
  if (!Number.isFinite(millis)) return false;
  await kvSet(INBOX_CURSOR_KEY, String(millis));
  return true;
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
    const body = row.rawText;
    // Read again from scratch; a message that still fails or still has no rate is logged as failed again.
    db.delete(captureLog).where(eq(captureLog.fingerprint, row.fingerprint)).run();
    try {
      await serial(() =>
        readMessage({
          key: row.sender,
          channel: row.channel,
          address: row.channel === 'sms' ? row.sender : null,
          body,
          receivedAt: row.receivedAt,
          fingerprint: row.fingerprint,
        }),
      );
    } catch (e) {
      // Put it back as it was, so the message isn't lost.
      db.insert(captureLog).values(row).onConflictDoNothing().run();
      throw e;
    }
    const now = db.select({ status: captureLog.status }).from(captureLog).where(eq(captureLog.fingerprint, row.fingerprint)).get();
    if (now?.status === 'failed') continue;
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
    } else if (data.kind === 'app_candidate') {
      // CAP-12: only the app's name came; Review asks once whether to read it.
      await noteAppCandidate(data.packageName, data.appName);
      return;
    } else {
      await captureNotification(data);
    }
    notifyLedgerChange();
    await checkPaceAlerts().catch(reportBackground('pace-alerts'));
    await refreshRecurring().catch(reportBackground('recurring'));
    await refreshIous().catch(reportBackground('ious'));
    await syncNow();
    await categoriseWithAi();
  } catch (e) {
    // Keep message contents out of logs and the error log: only the error's name and where it was thrown.
    console.warn('Capture task failed:', e instanceof Error ? e.name : 'unknown error');
    reportBackground('capture', { withoutMessage: true })(e);
  }
}
