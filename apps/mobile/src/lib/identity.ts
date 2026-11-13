import { and, eq, isNull } from 'drizzle-orm';
import { accounts, personIdentifiers, type LocalPersonIdentifier } from '@money-plant/db-schema';
import {
  identifierClashes,
  isSelfPayee,
  isStrong,
  matchPayee,
  normaliseIdentifier,
  payeeIdentifiers,
  type IdentifiedPerson,
  type Identifier,
  type IdentifierKind,
  type IdentifierSource,
  type Payee,
  type PayeeMatch,
} from '@money-plant/matcher';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { derivedId } from './ids';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';

/**
 * Decision 0025: who a person is. Each of the user's people has identifiers
 * (UPI IDs, phone, bank accounts, payee names) in `person_identifiers`, and
 * the user's own profile is in `my_identifiers` on the server, which accepted
 * friends read.
 */

const now = () => new Date().toISOString();

/**
 * The row id: a strong identifier's id comes from the identifier alone, so it
 * can only ever be on one person and two phones write the same row. A weak
 * one (a payee name) can be on several people, so the person is part of it.
 */
export function identifierRowId(id: Identifier, personId: string): Promise<string> {
  const bank = id.kind === 'bank_account' ? `${id.label ?? ''}:` : '';
  return derivedId(isStrong(id) ? `identifier:${id.kind}:${bank}${id.value}` : `identifier:${id.kind}:${bank}${id.value}:${personId}`);
}

export const toIdentifier = (row: Pick<LocalPersonIdentifier, 'kind' | 'value' | 'label' | 'source'>): Identifier => ({
  kind: row.kind,
  value: row.value,
  label: row.label,
  source: row.source,
});

/** Every live identifier, by person. */
export async function identifiersByPerson(): Promise<Map<string, LocalPersonIdentifier[]>> {
  const db = await getDb();
  const rows = db.select().from(personIdentifiers).where(isNull(personIdentifiers.deletedAt)).all();
  const out = new Map<string, LocalPersonIdentifier[]>();
  for (const row of rows) out.set(row.personAccountId, [...(out.get(row.personAccountId) ?? []), row]);
  return out;
}

/** The user's live people with their identifiers; a person's pay-to UPI ID counts too. */
export async function identifiedPeople(): Promise<(IdentifiedPerson & { email: string | null })[]> {
  const db = await getDb();
  const people = db.select().from(accounts).where(and(eq(accounts.type, 'person'), isNull(accounts.deletedAt))).all();
  const byPerson = await identifiersByPerson();
  return people.map((p) => {
    const ids = (byPerson.get(p.id) ?? []).map(toIdentifier);
    const pay = p.vpa ? normaliseIdentifier('upi', p.vpa) : null;
    if (pay && !ids.some((i) => i.kind === 'upi' && i.value === pay.value)) ids.push({ ...pay, source: 'typed' });
    return { id: p.id, name: p.name, email: p.email, identifiers: ids };
  });
}

/** One identifier is on another person already. Carries them, so the screen can offer to merge. */
export class IdentifierClashError extends Error {
  constructor(
    readonly other: { id: string; name: string },
    readonly identifier: Identifier,
  ) {
    super(`${other.name} already has ${describe(identifier)}. If they're the same person, merge them instead.`);
    this.name = 'IdentifierClashError';
  }
}

export function describe(id: Identifier): string {
  switch (id.kind) {
    case 'upi':
      return `the UPI ID ${id.value}`;
    case 'phone':
      return `the number ${id.value}`;
    case 'bank_account':
      return `the ${id.label ? `${id.label.toUpperCase()} ` : ''}account ending ${id.value.slice(-4)}`;
    case 'payee_name':
      return `the name ${id.value}`;
  }
}

/**
 * Adds identifiers to a person. A strong one another person already has is
 * refused when typed (`IdentifierClashError`) and skipped when learned or
 * from a friend: a payment or a profile never moves it silently. Returns the
 * ones skipped for that reason.
 */
export async function addIdentifiers(personId: string, ids: readonly Identifier[], source: IdentifierSource): Promise<Identifier[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const people = await identifiedPeople();
  const skipped: Identifier[] = [];
  let changed = false;
  for (const raw of ids) {
    const id = { ...raw, source };
    const clash = identifierClashes(people, personId, [id])[0];
    if (clash) {
      if (source === 'typed') throw new IdentifierClashError({ id: clash.person.id, name: clash.person.name }, id);
      skipped.push(id);
      continue;
    }
    const rowId = await identifierRowId(id, personId);
    const existing = db.select().from(personIdentifiers).where(eq(personIdentifiers.id, rowId)).get();
    if (existing && !existing.deletedAt && existing.personAccountId === personId) {
      // A typed one stays typed; a learned one becomes typed when the user types it.
      if (source === 'typed' && existing.source !== 'typed') {
        db.update(personIdentifiers).set({ source, dirty: 1, rev: existing.rev + 1 }).where(eq(personIdentifiers.id, rowId)).run();
        changed = true;
      }
      continue;
    }
    const row = {
      id: rowId,
      personAccountId: personId,
      kind: id.kind,
      value: id.value,
      label: id.kind === 'bank_account' ? (id.label ?? null) : null,
      source,
      createdAt: existing?.createdAt ?? now(),
      deletedAt: null,
      dirty: 1,
      rev: (existing?.rev ?? 0) + 1,
    };
    db.insert(personIdentifiers).values(row).onConflictDoUpdate({ target: personIdentifiers.id, set: row }).run();
    changed = true;
  }
  if (changed) notifyLedgerChange();
  return skipped;
}

export async function removeIdentifier(rowId: string): Promise<void> {
  const db = await getDb();
  const row = db.select().from(personIdentifiers).where(eq(personIdentifiers.id, rowId)).get();
  if (!row || row.deletedAt) return;
  db.update(personIdentifiers).set({ deletedAt: now(), dirty: 1, rev: row.rev + 1 }).where(eq(personIdentifiers.id, rowId)).run();
  notifyLedgerChange();
}

/**
 * Makes a person's identifiers of these kinds exactly `wanted` (typed on the
 * person screen): adds the new ones, removes the ones left out.
 */
export async function setIdentifiersOfKind(personId: string, kinds: readonly IdentifierKind[], wanted: readonly Identifier[]): Promise<void> {
  const db = await getDb();
  await addIdentifiers(personId, wanted, 'typed');
  const rows = db
    .select()
    .from(personIdentifiers)
    .where(and(eq(personIdentifiers.personAccountId, personId), isNull(personIdentifiers.deletedAt)))
    .all();
  for (const row of rows) {
    if (!kinds.includes(row.kind)) continue;
    if (!wanted.some((w) => w.kind === row.kind && w.value === row.value)) await removeIdentifier(row.id);
  }
}

/** A merge (decision 0020): every identifier of `fromId` moves to `toId`. */
export async function moveIdentifiers(fromId: string, toId: string): Promise<void> {
  const db = await getDb();
  const rows = db
    .select()
    .from(personIdentifiers)
    .where(and(eq(personIdentifiers.personAccountId, fromId), isNull(personIdentifiers.deletedAt)))
    .all();
  for (const row of rows) {
    const id = toIdentifier(row);
    const nextId = await identifierRowId(id, toId);
    if (nextId === row.id) {
      db.update(personIdentifiers).set({ personAccountId: toId, dirty: 1, rev: row.rev + 1 }).where(eq(personIdentifiers.id, row.id)).run();
    } else {
      db.update(personIdentifiers).set({ deletedAt: now(), dirty: 1, rev: row.rev + 1 }).where(eq(personIdentifiers.id, row.id)).run();
      const fresh = { ...row, id: nextId, personAccountId: toId, createdAt: now(), deletedAt: null, dirty: 1, rev: 1 };
      db.insert(personIdentifiers).values(fresh).onConflictDoUpdate({ target: personIdentifiers.id, set: fresh }).run();
    }
  }
}

/** When a person is removed, what identified them goes too. */
export async function removeIdentifiersOf(personId: string): Promise<void> {
  const db = await getDb();
  const rows = db
    .select()
    .from(personIdentifiers)
    .where(and(eq(personIdentifiers.personAccountId, personId), isNull(personIdentifiers.deletedAt)))
    .all();
  for (const row of rows) db.update(personIdentifiers).set({ deletedAt: now(), dirty: 1, rev: row.rev + 1 }).where(eq(personIdentifiers.id, row.id)).run();
}

/** The user said a payment was to or from this person: learn its UPI ID, number, account and name. */
export async function learnFromPayee(personId: string, payee: Payee): Promise<void> {
  await addIdentifiers(personId, payeeIdentifiers(payee), 'learned');
}

/** Who a payment is to or from (decision 0025): strong, learned name, or only a suggestion. */
export async function matchPersonForPayee(payee: Payee): Promise<PayeeMatch<IdentifiedPerson> | null> {
  return matchPayee(await identifiedPeople(), payee);
}

// ---- The user's own profile ----

export interface MyIdentifier extends Identifier {
  id: string;
  shared: boolean;
}

const MY_KEY = 'me.identifiers';

interface RemoteMine {
  id: string;
  kind: IdentifierKind;
  value: string;
  label: string | null;
  shared: boolean;
}

/** The user's own identifiers, from the server; the last copy is kept for capture to tell self-transfers apart. */
export async function loadMyIdentifiers(userId: string): Promise<MyIdentifier[]> {
  const { data, error } = await supabase
    .from('my_identifiers')
    .select('id, kind, value, label, shared')
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (error) throw error;
  const mine = ((data ?? []) as RemoteMine[]).map((r) => ({ id: r.id, kind: r.kind, value: r.value, label: r.label, shared: r.shared }));
  await kvSet(MY_KEY, JSON.stringify(mine));
  return mine;
}

/** The last copy of the user's own identifiers, without the network. */
export async function cachedMyIdentifiers(): Promise<MyIdentifier[]> {
  try {
    const raw = await kvGet(MY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as MyIdentifier[]) : [];
  } catch {
    return [];
  }
}

/** For the capture pipeline: a payment to or from one of the user's own UPI IDs or accounts. */
export async function selfCheck(): Promise<(payee: Payee) => boolean> {
  const mine = await cachedMyIdentifiers();
  return (payee) => mine.length > 0 && isSelfPayee(mine, payee);
}

/** Needs the network: adds one identifier to the user's own profile. */
export async function addMyIdentifier(userId: string, kind: IdentifierKind, raw: string, label?: string | null, shared = true): Promise<void> {
  const parsed = normaliseIdentifier(kind, raw, label);
  if (!parsed) throw new Error(invalidMessage(kind));
  if (parsed.kind === 'bank_account' && !parsed.label) throw new Error('Enter the bank too, like HDFC');
  // Only the last 4 digits of an account are ever kept, so friends never see the full number.
  const id = parsed.kind === 'bank_account' ? { ...parsed, value: parsed.value.slice(-4) } : parsed;
  const rowId = await derivedId(`me:${id.kind}:${id.kind === 'bank_account' ? `${id.label ?? ''}:` : ''}${id.value}`);
  const { error } = await supabase
    .from('my_identifiers')
    .upsert({ id: rowId, kind: id.kind, value: id.value, label: id.kind === 'bank_account' ? (id.label ?? null) : null, shared, deleted_at: null });
  if (error) throw error;
  await loadMyIdentifiers(userId);
}

export async function setMyIdentifierShared(userId: string, rowId: string, shared: boolean): Promise<void> {
  const { error } = await supabase.from('my_identifiers').update({ shared }).eq('id', rowId);
  if (error) throw error;
  await loadMyIdentifiers(userId);
}

export async function removeMyIdentifier(userId: string, rowId: string): Promise<void> {
  const { error } = await supabase.from('my_identifiers').update({ deleted_at: now() }).eq('id', rowId);
  if (error) throw error;
  await loadMyIdentifiers(userId);
}

export function invalidMessage(kind: IdentifierKind): string {
  switch (kind) {
    case 'upi':
      return 'Enter a UPI ID like name@okaxis';
    case 'phone':
      return 'Enter a 10-digit mobile number';
    case 'bank_account':
      return 'Enter the account number, or at least its last 4 digits';
    case 'payee_name':
      return 'Enter the name as your bank shows it';
  }
}

/** Friends' shared profiles (decision 0025), by their user id. RLS returns only accepted friends' shared rows. */
export async function friendsIdentifiers(friendIds: readonly string[]): Promise<Map<string, Identifier[]>> {
  const out = new Map<string, Identifier[]>();
  if (friendIds.length === 0) return out;
  const { data, error } = await supabase
    .from('my_identifiers')
    .select('user_id, kind, value, label')
    .in('user_id', [...friendIds])
    .is('deleted_at', null)
    .eq('shared', true);
  if (error) throw error;
  for (const r of (data ?? []) as { user_id: string; kind: IdentifierKind; value: string; label: string | null }[]) {
    const id = normaliseIdentifier(r.kind, r.value, r.label);
    if (id) out.set(r.user_id, [...(out.get(r.user_id) ?? []), { ...id, source: 'friend' }]);
  }
  return out;
}

/** Brings a friend's person in line with their shared profile: adds what's new, drops what they removed. */
export async function syncFriendIdentifiers(personId: string, theirs: readonly Identifier[]): Promise<boolean> {
  const db = await getDb();
  const before = db
    .select()
    .from(personIdentifiers)
    .where(and(eq(personIdentifiers.personAccountId, personId), isNull(personIdentifiers.deletedAt)))
    .all();
  const fresh = theirs.filter((t) => !before.some((b) => b.kind === t.kind && b.value === t.value && (b.label ?? null) === (t.label ?? null)));
  const skipped = await addIdentifiers(personId, fresh, 'friend');
  let changed = fresh.length > skipped.length;
  for (const row of before) {
    if (row.source !== 'friend') continue;
    if (!theirs.some((t) => t.kind === row.kind && t.value === row.value && (t.label ?? null) === (row.label ?? null))) {
      await removeIdentifier(row.id);
      changed = true;
    }
  }
  return changed;
}
