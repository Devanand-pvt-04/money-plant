import { and, asc, eq, sql } from 'drizzle-orm';
import { accounts, captureLog } from '@money-plant/db-schema';
import { identifyBankSender, normaliseSender, UPI_APP_PACKAGES } from '@money-plant/parser';
import { setCaptureFilters } from '../../modules/sms-reader';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { kvGet, kvSet } from './kv';

/**
 * CAP-11 and CAP-12: which senders and apps the user linked, ignored or
 * approved. Kept on this phone, like contact links: the receiver reads a
 * copy before JavaScript starts (setCaptureFilters), and message text never
 * leaves the phone.
 */

const SENDERS_KEY = 'capture.senders';
const APPS_KEY = 'capture.apps';

/** A sender without tuned rules: linked to an account, or ignored. Missing means not asked yet. */
export type SenderChoice = { accountId: string } | { ignored: true };

/** An app outside the built-in list that posted a money notification (CAP-12). */
export interface AppChoice {
  name: string;
  state: 'asked' | 'approved' | 'denied';
}

/** Messages from apps are logged under this sender, so apps and SMS senders share one list. */
export const appSender = (packageName: string) => `APP:${packageName}`;
export const appOfSender = (sender: string) => (sender.startsWith('APP:') ? sender.slice(4) : null);

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
export const appChoices = () => readJson<AppChoice>(APPS_KEY);

/** Hands the choices to the native receiver and listener, so ignored senders and apps are dropped there. */
export async function syncCaptureFilters(): Promise<void> {
  const [senders, apps] = await Promise.all([senderChoices(), appChoices()]);
  setCaptureFilters({
    ignoredSenders: Object.entries(senders).filter(([, c]) => 'ignored' in c).map(([s]) => s),
    approvedApps: Object.entries(apps).filter(([, a]) => a.state === 'approved').map(([p]) => p),
    deniedApps: Object.entries(apps).filter(([, a]) => a.state === 'denied').map(([p]) => p),
  });
}

async function saveSenders(choices: Record<string, SenderChoice>): Promise<void> {
  await kvSet(SENDERS_KEY, JSON.stringify(choices));
  await syncCaptureFilters();
}

async function saveApps(choices: Record<string, AppChoice>): Promise<void> {
  await kvSet(APPS_KEY, JSON.stringify(choices));
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

/** CAP-12: an app outside the built-in list posted a money notification. Asked about once. */
export async function noteAppCandidate(packageName: string, name: string): Promise<void> {
  if (UPI_APP_PACKAGES[packageName]) return;
  const apps = await appChoices();
  if (apps[packageName]) return;
  apps[packageName] = { name: name.slice(0, 60) || packageName, state: 'asked' };
  await saveApps(apps);
  notifyLedgerChange();
}

/** The user's answer to "Read payments from Revolut?". */
export async function setAppApproved(packageName: string, approved: boolean): Promise<void> {
  const apps = await appChoices();
  const app = apps[packageName];
  apps[packageName] = { name: app?.name ?? packageName, state: approved ? 'approved' : 'denied' };
  await saveApps(apps);
  notifyLedgerChange();
}

/** What Review asks about: new senders with waiting messages, and new apps. */
export interface CaptureQuestions {
  senders: { sender: string; name: string; waiting: number }[];
  apps: { packageName: string; name: string }[];
}

export async function captureQuestions(): Promise<CaptureQuestions> {
  const db = await getDb();
  const [choices, apps] = await Promise.all([senderChoices(), appChoices()]);
  const waiting = db
    .select({ sender: captureLog.sender, count: sql<number>`count(*)` })
    .from(captureLog)
    .where(eq(captureLog.status, 'waiting'))
    .groupBy(captureLog.sender)
    .orderBy(asc(captureLog.sender))
    .all();
  return {
    senders: waiting
      .filter((w) => !choices[w.sender])
      .map((w) => ({ sender: w.sender, name: senderName(w.sender, apps), waiting: Number(w.count) })),
    apps: Object.entries(apps)
      .filter(([, a]) => a.state === 'asked')
      .map(([packageName, a]) => ({ packageName, name: a.name })),
  };
}

/** "ENBD", or the app's name for notifications. */
export function senderName(sender: string, apps: Record<string, AppChoice>): string {
  const app = appOfSender(sender);
  return app ? (apps[app]?.name ?? UPI_APP_PACKAGES[app] ?? app) : sender;
}

/** One row of Settings → Capture (CAP-11, CAP-8). */
export interface SenderRow {
  sender: string;
  name: string;
  /** Tuned rules (ICICI, HDFC, HSBC, SBI, PNB, slice), or the general reader. */
  tuned: boolean;
  account: { id: string; name: string } | null;
  ignored: boolean;
  parsed: number;
  skipped: number;
  failed: number;
  waiting: number;
}

export async function listSenderRows(): Promise<SenderRow[]> {
  const db = await getDb();
  const [choices, apps] = await Promise.all([senderChoices(), appChoices()]);
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
    .groupBy(captureLog.sender)
    .all();
  const bySender = new Map(counts.map((c) => [c.sender, c]));
  const all = new Set([...bySender.keys(), ...Object.keys(choices)]);
  return [...all]
    .map((sender) => {
      const c = bySender.get(sender);
      const choice = choices[sender];
      const accountId = choice && 'accountId' in choice ? choice.accountId : null;
      return {
        sender,
        name: senderName(sender, apps),
        tuned: !appOfSender(sender) && identifyBankSender(sender) !== null,
        account: accountId ? { id: accountId, name: names.get(accountId) ?? 'Removed account' } : null,
        ignored: !!choice && 'ignored' in choice,
        parsed: Number(c?.parsed ?? 0),
        skipped: Number(c?.skipped ?? 0),
        failed: Number(c?.failed ?? 0),
        waiting: Number(c?.waiting ?? 0),
      };
    })
    .sort((a, b) => Number(b.tuned) - Number(a.tuned) || a.name.localeCompare(b.name));
}

/** Settings → Capture: the user adds a sender by name before its first message, already linked. */
export async function addSender(name: string, accountId: string): Promise<void> {
  const sender = normaliseSender(name);
  if (!sender) throw new Error('Enter the sender name as it shows in Messages');
  if (!/[A-Z]/.test(sender) && !/^\d{3,6}$/.test(sender)) throw new Error("Phone numbers can't be added: messages from people are never read");
  await linkSender(sender, accountId);
}
