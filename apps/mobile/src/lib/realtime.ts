import { notifyLedgerChange } from './events';
import { refreshIous } from './ious';
import { supabase } from './supabase';
import { syncNow } from './sync';

/**
 * IOU-2, IOU-4: when a friend confirms an IOU or records a repayment, the
 * change arrives within seconds instead of at the next sync. Row-level
 * security decides which changes this user is sent. Returns an unsubscribe.
 */
export function watchSharedIous(userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Several rows often change together; sync once for the burst.
  const pull = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      syncNow()
        .then(() => refreshIous())
        .then(notifyLedgerChange, () => {});
    }, 1500);
  };
  const channel = supabase
    .channel(`shared-ious:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ious' }, pull)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'iou_payments' }, pull)
    .subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}
