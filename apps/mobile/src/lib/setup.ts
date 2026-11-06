import { and, inArray, isNull } from 'drizzle-orm';
import { accounts, budgets } from '@money-plant/db-schema';
import { contactsAllowed } from './contacts';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { isNotificationAccessGranted, isSmsReaderAvailable } from '../../modules/sms-reader';

/**
 * ACC-10: the "Finish setting up" card on Home, for the steps the first-run
 * wizard leaves out. It shows only for people who went through the wizard,
 * and goes away once every step is done or the user dismisses it.
 */

const STARTED_KEY = 'setup.started';
const DISMISSED_KEY = 'setup.dismissed';
const INVITED_KEY = 'setup.invited';

export type SetupStep = 'notifications' | 'contacts' | 'investments' | 'budget' | 'invite';

export interface SetupState {
  steps: { key: SetupStep; done: boolean }[];
  done: number;
}

/** Called when the wizard finishes, so the card appears on Home. */
export async function startSetup(): Promise<void> {
  await kvSet(STARTED_KEY, new Date().toISOString());
}

export async function dismissSetup(): Promise<void> {
  await kvSet(DISMISSED_KEY, new Date().toISOString());
}

/** Inviting happens on the server; remember on the phone that the user did it once. */
export async function markInvited(): Promise<void> {
  await kvSet(INVITED_KEY, new Date().toISOString());
}

/** The card's state, or null when it shouldn't show. */
export async function setupState(): Promise<SetupState | null> {
  const [started, dismissed] = await Promise.all([kvGet(STARTED_KEY), kvGet(DISMISSED_KEY)]);
  if (!started || dismissed) return null;
  const db = await getDb();
  const investments = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), inArray(accounts.type, ['mutual_fund', 'stock', 'nps', 'savings_scheme', 'fd', 'rd'])))
    .limit(1)
    .all();
  const budget = db.select({ id: budgets.id }).from(budgets).where(isNull(budgets.deletedAt)).limit(1).all();
  const steps: SetupState['steps'] = [
    ...(isSmsReaderAvailable ? [{ key: 'notifications' as const, done: isNotificationAccessGranted() }] : []),
    { key: 'contacts', done: await contactsAllowed().catch(() => false) },
    { key: 'investments', done: investments.length > 0 },
    { key: 'budget', done: budget.length > 0 },
    { key: 'invite', done: (await kvGet(INVITED_KEY)) !== null },
  ];
  const done = steps.filter((s) => s.done).length;
  return done === steps.length ? null : { steps, done };
}
