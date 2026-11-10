import { and, asc, eq, like, ne, notLike, sql } from 'drizzle-orm';
import { accounts, captureLog } from '@money-plant/db-schema';
import { normaliseSender } from '@money-plant/parser';
import { setCaptureFilters } from '../../modules/sms-reader';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { kvGet, kvSet } from './kv';

/**
 * CAP-11: which SMS senders the user linked to an account or ignored. Kept on
 * this phone, like contact links: the receiver reads a copy before
 * JavaScript starts (setCaptureFilters), and message text never leaves the
 * phone. Every sender is treated the same; none is shown as a known bank.
 */

const SENDERS_KEY = 'capture.senders';
/** Choices about other apps' notifications, which are no longer read (decision 0019). Cleared on the next scan. */
const OLD_APPS_KEY = 'capture.apps';
/** Before decision 0019, approved apps' notifications were logged under `APP:<package>`. */
const OLD_APP_PREFIX = 'APP:';

/** A sender linked to an account, or ignored. Missing means the app finds the account from each message, or asks. */
export type SenderChoice = { accountId: string } | { ignored: true };

async function readJson<T>(key: string): Promise<Record<string, T>> {
  try {
    const raw = await kvGet(key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

export const senderChoices = () => readJson<SenderChoice>(SENDERS_KEY);

/** Hands the choices to the native receiver, so ignored senders are dropped there. No other app is ever read. */
export async function syncCaptureFilters(): Promise<void> {
  const senders = await senderChoices();
  setCaptureFilters({
    ignoredSenders: Object.entries(senders).filter(([, c]) => 'ignored' in c).map(([s]) => s),
    approvedApps: [],
    deniedApps: [],
  });
}

/**
 * Decision 0019: notifications from apps other than the built-in UPI and
 * bank apps are no longer read. Forgets the old answers and the messages
 * that waited under those apps, text included.
 */
export async function forgetOtherApps(): Promise<void> {
  const [old, choices] = await Promise.all([kvGet(OLD_APPS_KEY), senderChoices()]);
  const appKeys = Object.keys(choices).filter((s) => s.startsWith(OLD_APP_PREFIX));
  if (old !== null) await kvSet(OLD_APPS_KEY, '{}');
  if (appKeys.length > 0) {
    for (const key of appKeys) delete choices[key];
    await kvSet(SENDERS_KEY, JSON.stringify(choices));
  }
  const db = await getDb();
  db.delete(captureLog)
    .where(and(like(captureLog.sender, `${OLD_APP_PREFIX}%`), ne(captureLog.status, 'parsed')))
    .run();
}

async function saveSenders(choices: Record<string, SenderChoice>): Promise<void> {
  await kvSet(SENDERS_KEY, JSON.stringify(choices));
  await syncCaptureFilters();
}

/** Replays the messages that waited for this sender; set by capture.ts to avoid an import cycle. */
let replay: ((sender: string) => Promise<number>) | null = null;
export function setSenderReplay(run: (sender: string) => Promise<number>): void {
  replay = run;
}

/**
 * The user says which account a new sender's messages are for. Its waiting
 * messages are read into that account now, and later ones go straight there.
 */
export async function linkSender(sender: string, accountId: string): Promise<number> {
  const choices = await senderChoices();
  choices[sender] = { accountId };
  await saveSenders(choices);
  const read = replay ? await replay(sender) : 0;
  notifyLedgerChange();
  return read;
}

/** LED-9 for a whole sender: its messages are dropped, and the waiting ones forgotten. */
export async function ignoreSender(sender: string): Promise<void> {
  const choices = await senderChoices();
  choices[sender] = { ignored: true };
  await saveSenders(choices);
  const db = await getDb();
  db.update(captureLog)
    .set({ status: 'ignored', reason: 'ignored_sender', rawText: null })
    .where(and(eq(captureLog.sender, sender), eq(captureLog.status, 'waiting')))
    .run();
  notifyLedgerChange();
}

/** Undoes a link or an ignore: the sender is asked about again with its next message. */
export async function forgetSender(sender: string): Promise<void> {
  const choices = await senderChoices();
  delete choices[sender];
  await saveSenders(choices);
  notifyLedgerChange();
}

/** What Review asks about: senders whose messages wait because the app couldn't tell the account. */
export interface CaptureQuestions {
  senders: { sender: string; name: string; waiting: number }[];
}

export async function captureQuestions(): Promise<CaptureQuestions> {
  const db = await getDb();
  const choices = await senderChoices();
  const waiting = db
    .select({ sender: captureLog.sender, count: sql<number>`count(*)` })
    .from(captureLog)
    .where(and(eq(captureLog.status, 'waiting'), notLike(captureLog.sender, `${OLD_APP_PREFIX}%`)))
    .groupBy(captureLog.sender)
    .orderBy(asc(captureLog.sender))
    .all();
  return {
    senders: waiting.filter((w) => !choices[w.sender]).map((w) => ({ sender: w.sender, name: w.sender, waiting: Number(w.count) })),
  };
}

/** One row of Settings → Capture (CAP-11, CAP-8). */
export interface SenderRow {
  sender: string;
  name: string;
  account: { id: string; name: string } | null;
  ignored: boolean;
  parsed: number;
  skipped: number;
  failed: number;
  waiting: number;
}

export async function listSenderRows(): Promise<SenderRow[]> {
  const db = await getDb();
  const choices = await senderChoices();
  const names = new Map(db.select({ id: accounts.id, name: accounts.name }).from(accounts).all().map((a) => [a.id, a.name]));
  const counts = db
    .select({
      sender: captureLog.sender,
      parsed: sql<number>`sum(case when ${captureLog.status} = 'parsed' then 1 else 0 end)`,
      skipped: sql<number>`sum(case when ${captureLog.status} = 'ignored' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${captureLog.status} = 'failed' then 1 else 0 end)`,
      waiting: sql<number>`sum(case when ${captureLog.status} = 'waiting' then 1 else 0 end)`,
    })
    .from(captureLog)
    .where(notLike(captureLog.sender, `${OLD_APP_PREFIX}%`))
    .groupBy(captureLog.sender)
    .all();
  const bySender = new Map(counts.map((c) => [c.sender, c]));
  const all = new Set([...bySender.keys(), ...Object.keys(choices).filter((s) => !s.startsWith(OLD_APP_PREFIX))]);
  return [...all]
    .map((sender) => {
      const c = bySender.get(sender);
      const choice = choices[sender];
      const accountId = choice && 'accountId' in choice ? choice.accountId : null;
      return {
        sender,
        name: sender,
        account: accountId ? { id: accountId, name: names.get(accountId) ?? 'Removed account' } : null,
        ignored: !!choice && 'ignored' in choice,
        parsed: Number(c?.parsed ?? 0),
        skipped: Number(c?.skipped ?? 0),
        failed: Number(c?.failed ?? 0),
        waiting: Number(c?.waiting ?? 0),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Settings → Capture: the user adds a sender by name before its first message, already linked. */
export async function addSender(name: string, accountId: string): Promise<void> {
  const sender = normaliseSender(name);
  if (!sender) throw new Error('Enter the sender name as it shows in Messages');
  if (!/[A-Z]/.test(sender) && !/^\d{3,6}$/.test(sender)) throw new Error("Phone numbers can't be added: messages from people are never read");
  await linkSender(sender, accountId);
}
