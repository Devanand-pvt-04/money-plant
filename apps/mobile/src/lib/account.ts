import { supabase } from './supabase';
import { holdSync, recordClear, syncNow } from './sync';
import { wipeLocal } from './wipe';

/**
 * ACC-7: deletes every entry, account, category, rule, budget, recurring
 * payment, group and IOU on the server and on this phone, and keeps the
 * sign-in, name and UPI ID. The app then starts again from first run: the
 * default categories come back and the SMS import is offered again.
 * Needs the network, since the server copy goes first.
 */
export async function clearMyData(): Promise<void> {
  await holdSync(async () => {
    const { data: clearedAt, error } = await supabase.rpc('clear_my_data');
    if (error) throw error;
    await wipeLocal({ keepSession: true });
    await recordClear(clearedAt as string);
    // Tells the user's other phones to empty themselves at their next sync.
    await supabase.auth.updateUser({ data: { data_cleared_at: clearedAt } }).catch(() => {});
  });
  await syncNow().catch(() => {});
}

/**
 * ACC-4: deletes the sign-in and everything stored with it on the server,
 * then signs out and empties this phone. IOUs a friend recorded stay in
 * their ledger, no longer linked to this user.
 */
export async function deleteAccount(): Promise<void> {
  await holdSync(async () => {
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) throw error;
    // The session is no longer valid on the server; this only clears it here.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    await wipeLocal({ keepSession: false });
  });
}
