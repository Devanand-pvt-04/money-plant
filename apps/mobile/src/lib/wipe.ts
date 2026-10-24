import { not, like } from 'drizzle-orm';
import {
  accountTypes,
  accounts,
  balanceAnchors,
  balanceRefs,
  budgets,
  captureLog,
  iouPayments,
  ious,
  kv,
  merchantCache,
  pendingNotifications,
  personContacts,
  postings,
  recurring,
  rules,
  sources,
  splitGroups,
  transactions,
} from '@money-plant/db-schema';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { cancelScheduled } from './notifications';

/** Where supabase-js keeps the session in the kv table ("sb-<project>-auth-token"). */
const AUTH_KEYS = 'sb-%';

/**
 * Empties this phone's database: every entry, account, category, rule,
 * budget, IOU, sync cursor and capture log, including the SMS text kept for
 * failed messages. With `keepSession` the user stays signed in (ACC-7);
 * otherwise the stored session goes too (sign out, ACC-4).
 */
export async function wipeLocal(options: { keepSession: boolean }): Promise<void> {
  // Reminders name payees and amounts.
  await cancelScheduled('').catch(() => {});
  const db = await getDb();
  db.transaction((t) => {
    for (const table of [
      postings,
      sources,
      balanceAnchors,
      balanceRefs,
      transactions,
      rules,
      budgets,
      recurring,
      iouPayments,
      ious,
      splitGroups,
      personContacts,
      accounts,
      accountTypes,
      merchantCache,
      pendingNotifications,
      captureLog,
    ]) {
      t.delete(table).run();
    }
    if (options.keepSession) t.delete(kv).where(not(like(kv.key, AUTH_KEYS))).run();
    else t.delete(kv).run();
  });
  notifyLedgerChange();
}
