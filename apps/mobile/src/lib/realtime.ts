import { notifyLedgerChange } from './events';
import { supabase } from './supabase';
import { syncNow } from './sync';

/**
 * Decision 0026: when a friend adds, changes or answers a shared item, the
 * change arrives within seconds instead of at the next sync, and so does a
 * link made on the user's other phone. Row-level security decides which
 * changes this user is sent. Returns an unsubscribe.
 */
export function watchSharedItems(userId: string): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Several rows often change together; sync once for the burst. Sync reconciles the entries.
  const pull = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      syncNow().then(notifyLedgerChange, () => {});
    }, 1500);
  };
  const channel = supabase
    .channel(`shared-items:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_items' }, pull)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'item_links' }, pull)
    .subscribe();
  return () => {
    if (timer) clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}
