import { useCallback, useState } from 'react';
import { categoriseWithAi } from './ai-categorise';
import { refreshAiReview } from './ai-review';
import { fillMissingPayees, hasImportedInbox, importInbox } from './capture';
import { refreshDeposits } from './deposits';
import { reportBackground } from './errors';
import { refreshFunds } from './funds';
import { refreshDemat } from './demat';
import { refreshIous } from './ious';
import { refreshRecurring } from './recurring';
import { scheduleMonthReview } from './review';
import { syncNow } from './sync';
import { hasSmsPermission, isSmsReaderAvailable } from '../../modules/sms-reader';

/** Catching up (SMS, sync, the background passes) on focus at most this often; pulling down always does it. */
const CATCH_UP_MS = 2 * 60_000;
let lastCatchUp = 0;
let running: Promise<void> | null = null;

/** Whether a catch-up on focus or on return to the app is due. */
export function catchUpDue(): boolean {
  return Date.now() - lastCatchUp > CATCH_UP_MS;
}

/**
 * Catches up on SMS that arrived while the receiver couldn't run, syncs, and
 * starts the passes that act on new entries. Concurrent calls share one run.
 * Throws when the sync fails.
 */
export function refreshAll(): Promise<void> {
  running ??= (async () => {
    lastCatchUp = Date.now();
    try {
      if (isSmsReaderAvailable && hasSmsPermission() && (await hasImportedInbox())) await importInbox();
      // Payees a newer parser can now read, for entries captured before it (once per parser change).
      await fillMissingPayees().catch(reportBackground('payees'));
      await syncNow();
      // REC-1, REC-4: new debits mark payments paid, steady ones become suggestions, reminders follow.
      refreshRecurring().catch(reportBackground('recurring'));
      // NW-2: RD instalments and FD payments become transfers into their deposits.
      refreshDeposits().catch(reportBackground('deposits'));
      // NW-3: SIP debits become transfers into their funds; today's NAVs once a day.
      refreshFunds().catch(reportBackground('funds'));
      // NW-5, NW-6: money to brokers becomes transfers into demat accounts; closing prices and NPS NAVs every 6 hours.
      refreshDemat().catch(reportBackground('demat'));
      // BUD-4: the review notification for the 1st of next month.
      scheduleMonthReview().catch(reportBackground('month-review'));
      // IOU-4: payments from people who owe the user settle their IOUs.
      refreshIous().catch(reportBackground('ious'));
      // CAT-2: only merchants that rules, patterns and the dictionary couldn't place; capped on the server.
      categoriseWithAi().catch(reportBackground('ai-categorise'));
      // BUD-4, decision 0012: last month's AI write-up, queued once the month ends.
      refreshAiReview().catch(reportBackground('ai-review'));
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Pull to refresh for a tab: runs refreshAll, then reloads the screen. */
export function usePullToRefresh(reload: () => unknown) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAll();
      setError(null);
    } catch (e) {
      setError(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
      reload();
    }
  }, [reload]);
  return { refreshing, onRefresh, error };
}
