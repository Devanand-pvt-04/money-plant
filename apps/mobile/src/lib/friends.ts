import * as Crypto from 'expo-crypto';
import { notifyLedgerChange } from './events';
import { identifierClashes, mergeIdentifiers, normaliseIdentifier, type Identifier } from '@money-plant/matcher';
import { eq } from 'drizzle-orm';
import { accounts } from '@money-plant/db-schema';
import { getDb } from './db';
import { kvSet } from './kv';
import { addIdentifiers, friendsIdentifiers, identifiedPeople, syncFriendIdentifiers } from './identity';
import { createPerson, updatePerson } from './people';
import { getMe, isVpa, type Me } from './me';
import { supabase } from './supabase';

/**
 * Invites (ACC-8) and friend links (ACC-9). Both live only on the server, so
 * these screens need the internet. What a link changes on the phone, a person
 * account with the friend's name, email and UPI ID, is ordinary ledger data
 * and works offline once made.
 */

export interface Invite {
  id: string;
  email: string;
  usedAt: string | null;
  createdAt: string;
}

export type LinkState = 'friends' | 'waiting_for_them' | 'waiting_for_you';

export interface FriendLink {
  id: string;
  /** The other person, from this user's side. */
  email: string;
  name: string | null;
  vpa: string | null;
  /** Their other UPI IDs (decision 0021). */
  extraVpas: string[];
  phone: string | null;
  /** Their user id, once they are on Money Plant. */
  userId: string | null;
  state: LinkState;
  /** True when this user sent the request or the invite. */
  mine: boolean;
}

interface RemoteLink {
  id: string;
  user_id: string;
  requester_email: string | null;
  requester_name: string | null;
  requester_vpa: string | null;
  /** Missing before the decision 0021 migration. */
  requester_extra_vpas?: string[] | null;
  requester_phone?: string | null;
  friend_email: string;
  friend_user_id: string | null;
  friend_name: string | null;
  friend_vpa: string | null;
  friend_extra_vpas?: string[] | null;
  friend_phone?: string | null;
  accepted_at: string | null;
  declined_at: string | null;
}

/** Friends' user ids to their emails, so a friend's shared item finds their person (decision 0026). */
export const FRIEND_EMAILS_KEY = 'friends.emails';

/** Members can have this many open or used invites (decision 0016); admins have no limit. */
export const INVITE_LIMIT = 5;

export async function listInvites(): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('id, email, used_at, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ id: r.id, email: r.email, usedAt: r.used_at, createdAt: r.created_at }));
}

export type InviteResult = 'invited' | 'requested' | 'already_linked';

const INVITE_ERRORS: Record<string, string> = {
  invite_limit: `You've used your ${INVITE_LIMIT} invites. Withdraw one that hasn't been used to invite someone else.`,
  bad_email: 'Enter a valid email',
  self: "That's your own email",
};

/** Invites an email, or sends a friend request when that person is already on Money Plant. */
export async function inviteFriend(email: string): Promise<InviteResult> {
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('Enter a valid email');
  const { data, error } = await supabase.rpc('invite_friend', { p_id: Crypto.randomUUID(), p_email: clean });
  if (error) throw new Error(INVITE_ERRORS[error.hint ?? ''] ?? `Couldn't send that: ${error.message}`);
  return data as InviteResult;
}

export async function withdrawInvite(id: string): Promise<void> {
  const { error } = await supabase.from('invites').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** The message the share sheet sends with an invite: where to get the app and how to sign in. */
export function inviteMessage(email: string, me: Me): string {
  const from = me.name ?? me.email ?? 'A friend';
  const url = process.env.EXPO_PUBLIC_INSTALL_URL;
  return [
    `${from} invited you to Money Plant, a money tracker that fills itself from your bank SMS.`,
    '',
    url ? `1. Download the app: ${url}` : '1. Ask me for the app file.',
    '2. Android may block the install because the app reads bank SMS. In the Play Store, tap your profile picture, then Play Protect, then the settings gear, and turn off "Scan apps with Play Protect". Install, then turn it back on.',
    `3. Open Money Plant and sign in with ${email}.`,
  ].join('\n');
}

function toLink(row: RemoteLink, myId: string): FriendLink {
  const mine = row.user_id === myId;
  return {
    id: row.id,
    email: (mine ? row.friend_email : row.requester_email) ?? '',
    name: mine ? row.friend_name : row.requester_name,
    vpa: mine ? row.friend_vpa : row.requester_vpa,
    extraVpas: (mine ? row.friend_extra_vpas : row.requester_extra_vpas) ?? [],
    phone: (mine ? row.friend_phone : row.requester_phone) ?? null,
    userId: mine ? row.friend_user_id : row.user_id,
    state: row.accepted_at ? 'friends' : mine ? 'waiting_for_them' : 'waiting_for_you',
    mine,
  };
}

async function fetchLinks(): Promise<{ rows: RemoteLink[]; me: Me }> {
  const me = await getMe();
  const { data, error } = await supabase
    .from('friend_links')
    .select('id, user_id, requester_email, requester_name, requester_vpa, friend_email, friend_user_id, friend_name, friend_vpa, accepted_at, declined_at, requester_extra_vpas, friend_extra_vpas, requester_phone, friend_phone')
    .is('deleted_at', null)
    .is('declined_at', null);
  if (error) throw error;
  return { rows: (data ?? []) as RemoteLink[], me };
}

export async function listFriendLinks(): Promise<FriendLink[]> {
  const { rows, me } = await fetchLinks();
  return rows.map((r) => toLink(r, me.id)).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export async function respondToLink(id: string, accept: boolean): Promise<void> {
  const me = await getMe();
  const { error } = await supabase.rpc('respond_friend_link', { p_id: id, p_accept: accept, p_name: me.name, p_vpa: me.vpa, p_extra_vpas: me.extraVpas, p_phone: me.phone });
  if (error) throw error;
  if (accept) await syncFriendLinks();
}

export async function unlinkFriend(id: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_friend', { p_id: id });
  if (error) throw error;
}

/**
 * Runs after each sync. For every accepted link: keeps this user's own name
 * and UPI ID on the link current, and makes sure the friend is a person
 * account with their email and UPI ID, so IOUs with them are shared (IOU-2).
 * A name the user typed for a person is never replaced.
 */
export async function syncFriendLinks(): Promise<void> {
  const { rows, me } = await fetchLinks();
  for (const row of rows) {
    const mine = row.user_id === me.id;
    const myName = mine ? row.requester_name : row.friend_name;
    const myVpa = mine ? row.requester_vpa : row.friend_vpa;
    const myExtras = (mine ? row.requester_extra_vpas : row.friend_extra_vpas) ?? [];
    const myPhone = (mine ? row.requester_phone : row.friend_phone) ?? null;
    const extrasChanged = myExtras.join(',') !== me.extraVpas.join(',') || myPhone !== me.phone;
    if (row.accepted_at && (myName !== me.name || myVpa !== me.vpa || extrasChanged)) {
      const { error } = mine
        ? await supabase
            .from('friend_links')
            .update({ requester_name: me.name, requester_vpa: me.vpa, requester_extra_vpas: me.extraVpas, requester_phone: me.phone })
            .eq('id', row.id)
        : await supabase.rpc('respond_friend_link', { p_id: row.id, p_accept: true, p_name: me.name, p_vpa: me.vpa, p_extra_vpas: me.extraVpas, p_phone: me.phone });
      if (error) throw error;
    }
  }
  const accepted = rows.filter((r) => r.accepted_at).map((r) => toLink(r, me.id)).filter((l) => l.email);
  // Decision 0026: a friend's shared item names them by user id; this finds their person by email.
  await kvSet(FRIEND_EMAILS_KEY, JSON.stringify(Object.fromEntries(accepted.filter((l) => l.userId).map((l) => [l.userId, l.email]))));
  // Decision 0025: each friend's own profile, the identifiers they share.
  const profiles = await friendsIdentifiers(accepted.map((l) => l.userId).filter((u): u is string => u !== null)).catch(() => null);
  let changed = false;
  for (const link of accepted) {
    changed = (await ensurePerson(link, profiles ? (profiles.get(link.userId ?? '') ?? []) : null)) || changed;
  }
  if (changed) notifyLedgerChange();
}

/**
 * Makes sure an accepted friend is one person with their email, and that the
 * person carries what the friend shares about themselves (decision 0025).
 * Someone added earlier without an email who has one of the friend's UPI IDs,
 * numbers or accounts is that friend, so they get the email instead of a
 * second person being made. An identifier already on someone else is left
 * out, so a clash never stops sync; People then asks "Same person?".
 * `profile` is null when the profiles couldn't be read; the link's own UPI
 * IDs and phone are used then, and nothing is removed.
 */
async function ensurePerson(link: FriendLink, profile: Identifier[] | null): Promise<boolean> {
  const fromLink = [
    link.vpa ? normaliseIdentifier('upi', link.vpa) : null,
    ...link.extraVpas.map((v) => normaliseIdentifier('upi', v)),
    link.phone ? normaliseIdentifier('phone', link.phone) : null,
  ].filter((i): i is Identifier => i !== null).map((i) => ({ ...i, source: 'friend' as const }));
  const ids = mergeIdentifiers(profile ?? [], fromLink);
  const people = await identifiedPeople();
  let changed = false;
  let person = people.find((p) => p.email === link.email);
  if (!person) {
    const same = people.filter((p) => !p.email && identifierClashes([p], null, ids).length > 0);
    if (same.length === 1) {
      const account = (await getDb()).select().from(accounts).where(eq(accounts.id, same[0]!.id)).get();
      await updatePerson(same[0]!.id, { name: same[0]!.name, vpa: account?.vpa ?? null, email: link.email });
      person = same[0]!;
    } else {
      const pay = link.vpa ? normaliseIdentifier('upi', link.vpa) : null;
      const free = pay && identifierClashes(people, null, [pay]).length === 0 ? pay.value : null;
      const id = await createPerson({ name: link.name ?? link.email.split('@')[0] ?? link.email, vpa: free, email: link.email });
      person = { id, name: link.name ?? link.email, email: link.email, identifiers: [] };
    }
    changed = true;
  }
  if (profile !== null) return (await syncFriendIdentifiers(person.id, ids)) || changed;
  const known = person.identifiers;
  const fresh = ids.filter((i) => !known.some((o) => o.kind === i.kind && o.value === i.value));
  const skipped = await addIdentifiers(person.id, fresh, 'friend');
  return changed || fresh.length > skipped.length;
}

/** The link with a person, by their email, if any. */
export async function linkForEmail(email: string): Promise<FriendLink | null> {
  const links = await listFriendLinks();
  return links.find((l) => l.email === email.toLowerCase()) ?? null;
}
