import * as Crypto from 'expo-crypto';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DEFAULT_CURRENCY, paise, type CurrencyCode, type Paise } from '@money-plant/core';
import { accounts, iouPayments, ious, personContacts, postings, splitGroups, transactions, type LocalAccount } from '@money-plant/db-schema';
import { clashingPerson, findDuplicatePeople, findPerson, outstanding, pairKey, payeeKey, type DuplicatePair } from '@money-plant/matcher';
import { getDb } from './db';
import { homeConverter } from './home-money';
import { kvGet, kvSet } from './kv';
import { notifyLedgerChange } from './events';
import { getMe, isVpa } from './me';

export interface Person {
  account: LocalAccount;
  /**
   * Sum of postings in the home currency at today's rate: above zero they owe
   * the user, below zero the user owes them. Amounts whose rate isn't known
   * yet are left out (decision 0017).
   */
  balance: Paise;
  /** What is open in each currency, never converted, largest first (decision 0017). Empty when settled. */
  balances: { currency: CurrencyCode; amount: Paise }[];
  /** The phone contact this person is linked to, if any (local only, SPL-4). */
  contactId: string | null;
}

export async function listPeople(): Promise<Person[]> {
  const db = await getDb();
  const rows = db
    .select()
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), eq(accounts.type, 'person')))
    .orderBy(asc(accounts.name))
    .all();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sums = db
    .select({ accountId: postings.accountId, currency: postings.currency, total: sql<number>`sum(${postings.amountPaise})` })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(inArray(postings.accountId, ids), isNull(transactions.deletedAt)))
    .groupBy(postings.accountId, postings.currency)
    .all();
  const totals = new Map<string, Map<CurrencyCode, number>>();
  const add = (id: string, currency: CurrencyCode, amount: number) => {
    const own = totals.get(id) ?? new Map<CurrencyCode, number>();
    own.set(currency, (own.get(currency) ?? 0) + amount);
    totals.set(id, own);
  };
  for (const row of sums) add(row.accountId, row.currency ?? DEFAULT_CURRENCY, Number(row.total));
  for (const row of rows) if (row.openingBalancePaise !== 0) add(row.id, row.currency, row.openingBalancePaise);
  const at = new Date().toISOString();
  const converter = await homeConverter([...totals.values()].flatMap((own) => [...own.keys()].map((currency) => ({ currency, occurredAt: at }))));
  const contacts = new Map(db.select().from(personContacts).all().map((c) => [c.personAccountId, c.contactId]));
  return rows.map((account) => {
    const balances = [...(totals.get(account.id) ?? [])]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ currency, amount: paise(amount) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const balance = balances.reduce((sum, b) => sum + (converter.toHome(b.amount, b.currency, at) ?? 0), 0);
    return { account, balance: paise(balance), balances, contactId: contacts.get(account.id) ?? null };
  });
}

export async function getPerson(id: string): Promise<Person | null> {
  return (await listPeople()).find((p) => p.account.id === id) ?? null;
}

export interface PersonInput {
  name: string;
  vpa?: string | null;
  email?: string | null;
  contactId?: string | null;
}

function clean(input: PersonInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Enter a name');
  const vpa = input.vpa?.trim().toLowerCase() || null;
  if (vpa && !isVpa(vpa)) throw new Error('Enter a UPI ID like name@okaxis');
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email');
  return { name: name.slice(0, 80), vpa, email };
}

/**
 * Decision 0020: two people can't share an email or UPI ID. Carries the
 * other person, so the screen can offer to merge them instead.
 */
export class SamePersonError extends Error {
  constructor(
    readonly other: { id: string; name: string },
    readonly field: 'email' | 'vpa',
  ) {
    super(`${other.name} already has this ${field === 'email' ? 'email' : 'UPI ID'}. If they're the same person, merge them instead.`);
    this.name = 'SamePersonError';
  }
}

async function checkClash(self: string | null, fields: { email: string | null; vpa: string | null }): Promise<void> {
  if (!fields.email && !fields.vpa) return;
  const people = (await listPeople()).map((p) => ({ id: p.account.id, name: p.account.name, vpa: p.account.vpa, email: p.account.email }));
  const clash = clashingPerson(people, self, fields);
  if (clash) throw new SamePersonError({ id: clash.person.id, name: clash.person.name }, clash.field);
}

async function linkContact(personId: string, contactId: string | null | undefined): Promise<void> {
  if (contactId === undefined) return;
  const db = await getDb();
  db.delete(personContacts).where(eq(personContacts.personAccountId, personId)).run();
  if (contactId) db.insert(personContacts).values({ personAccountId: personId, contactId }).run();
}

export async function createPerson(input: PersonInput): Promise<string> {
  const fields = clean(input);
  await checkClash(null, fields);
  const db = await getDb();
  const id = Crypto.randomUUID();
  db.insert(accounts)
    .values({ id, type: 'person', ...fields, institution: null, last4: null, openingBalancePaise: 0, createdAt: new Date().toISOString(), dirty: 1 })
    .run();
  await linkContact(id, input.contactId);
  notifyLedgerChange();
  return id;
}

/**
 * Edits a person. A new email shares their open IOUs with that address
 * (IOU-2); the server asks them to confirm again. An email or UPI ID that
 * another person already has is refused (decision 0020).
 */
export async function updatePerson(id: string, input: PersonInput): Promise<void> {
  const fields = clean(input);
  const db = await getDb();
  const before = db.select().from(accounts).where(eq(accounts.id, id)).get();
  // Only what changed is checked, so an older pair that already clashes can still be renamed.
  await checkClash(id, { email: fields.email !== before?.email ? fields.email : null, vpa: fields.vpa !== before?.vpa ? fields.vpa : null });
  db.update(accounts)
    .set({ ...fields, dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id))
    .run();
  if (before && before.email !== fields.email) await shareIousOf(id, fields.email);
  await linkContact(id, input.contactId);
  notifyLedgerChange();
}

/**
 * Points this user's IOUs with a person at `email`. Settled ones stay as they
 * are: shared, they would reach the other person without their repayments and
 * look owed (decision 0020). A settled IOU shared with an email that is
 * changing is taken back instead.
 */
export async function shareIousOf(personId: string, email: string | null): Promise<void> {
  const db = await getDb();
  const me = await getMe();
  const rows = db
    .select()
    .from(ious)
    .where(and(eq(ious.personAccountId, personId), eq(ious.userId, me.id), isNull(ious.deletedAt)))
    .all();
  if (rows.length === 0) return;
  const payments = db
    .select()
    .from(iouPayments)
    .where(and(inArray(iouPayments.iouId, rows.map((r) => r.id)), isNull(iouPayments.deletedAt)))
    .all()
    .map((p) => ({ id: p.id, iouId: p.iouId, byMe: p.userId === me.id, amount: paise(p.amountPaise), paidAt: p.paidAt }));
  for (const row of rows) {
    if (row.counterpartyEmail === email) continue;
    const open = outstanding({ id: row.id, amount: paise(row.amountPaise) }, payments) > 0;
    const next = open ? email : null;
    if (row.counterpartyEmail === next) continue;
    db.update(ious)
      .set({ counterpartyEmail: next, dirty: 1, rev: sql`${ious.rev} + 1` })
      .where(eq(ious.id, row.id))
      .run();
  }
}

const ALIASES_KEY = 'people.aliases';

/**
 * IOU-4: payee names the user linked to a person (payeeKey to person id), so
 * "GOBAL NAIR" on a bank SMS is recognised as Gobal next time. Kept on this
 * phone only, like contact links (SPL-4).
 */
export async function payeeAliases(): Promise<Map<string, string>> {
  try {
    const raw = await kvGet(ALIASES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return new Map();
    return new Map(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return new Map();
  }
}

export async function saveAliases(aliases: ReadonlyMap<string, string>): Promise<void> {
  await kvSet(ALIASES_KEY, JSON.stringify(Object.fromEntries(aliases)));
}

/** The person a payee is, by UPI ID, a name linked before, or the exact name. Null when no one matches; nothing is created. */
export async function findPersonForPayee(payee: { name: string | null; vpa: string | null }): Promise<string | null> {
  const [people, aliases] = await Promise.all([listPeople(), payeeAliases()]);
  const found = findPerson(
    people.map((p) => ({ id: p.account.id, name: p.account.name, vpa: p.account.vpa })),
    payee,
    aliases,
  );
  return found?.id ?? null;
}

/**
 * The user said a payment was to or from this person: remember the payee's
 * name and UPI ID for them, so the next payment is recognised (IOU-4). A UPI
 * ID already on someone else is left alone.
 */
export async function rememberPayee(personId: string, payee: { name: string | null; vpa: string | null }): Promise<void> {
  const people = await listPeople();
  const person = people.find((p) => p.account.id === personId);
  if (!person) return;
  const key = payee.name ? payeeKey(payee.name) : '';
  if (key && key !== payeeKey(person.account.name)) {
    const aliases = await payeeAliases();
    if (aliases.get(key) !== personId) {
      aliases.set(key, personId);
      await saveAliases(aliases);
    }
  }
  const vpa = payee.vpa?.trim().toLowerCase();
  if (vpa && isVpa(vpa) && !person.account.vpa && !people.some((p) => p.account.vpa?.toLowerCase() === vpa)) {
    await updatePerson(personId, { name: person.account.name, vpa, email: person.account.email });
  }
}

function groupsWith(db: Awaited<ReturnType<typeof getDb>>, id: string) {
  return db
    .select({ id: splitGroups.id, name: splitGroups.name, members: splitGroups.memberAccountIds })
    .from(splitGroups)
    .where(isNull(splitGroups.deletedAt))
    .all()
    .filter((g) => {
      try {
        return (JSON.parse(g.members) as unknown[]).includes(id);
      } catch {
        return false;
      }
    });
}

/** Whether anything refers to this person: an entry, an IOU, a split group or a friend link. */
export async function personInUse(id: string): Promise<boolean> {
  const db = await getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account || account.email || account.openingBalancePaise !== 0) return true;
  const posting = db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(eq(postings.accountId, id), isNull(transactions.deletedAt)))
    .get();
  if (posting) return true;
  const iou = db
    .select({ id: ious.id })
    .from(ious)
    .where(and(isNull(ious.deletedAt), or(eq(ious.personAccountId, id), eq(ious.counterpartyPersonAccountId, id))))
    .get();
  if (iou) return true;
  return groupsWith(db, id).length > 0;
}

/**
 * Why this person can't be removed, or null when they can (decision 0020).
 * Someone nothing refers to is simply removed. Someone with history is
 * removed only when settled: their past entries keep their name, but they
 * leave People and pickers. Someone linked on Money Plant comes back with
 * the friend link, so they stay.
 */
export async function removalBlocker(id: string): Promise<string | null> {
  if (!(await personInUse(id))) return null;
  const person = await getPerson(id);
  if (!person) return 'Person not found';
  const name = person.account.name;
  if (person.account.email) return `${name} is linked on Money Plant by email, so they stay. Merge a duplicate into them instead.`;
  if (person.balances.length > 0) return `${name} isn't settled up. Settle up, or merge them into the right person.`;
  const db = await getDb();
  const me = await getMe();
  const rows = db
    .select()
    .from(ious)
    .where(and(isNull(ious.deletedAt), isNull(ious.declinedAt), or(eq(ious.personAccountId, id), eq(ious.counterpartyPersonAccountId, id))))
    .all();
  if (rows.length > 0) {
    const payments = db
      .select()
      .from(iouPayments)
      .where(and(inArray(iouPayments.iouId, rows.map((r) => r.id)), isNull(iouPayments.deletedAt)))
      .all()
      .map((p) => ({ id: p.id, iouId: p.iouId, byMe: p.userId === me.id, amount: paise(p.amountPaise), paidAt: p.paidAt }));
    if (rows.some((r) => outstanding({ id: r.id, amount: paise(r.amountPaise) }, payments) > 0)) {
      return `${name} still has an open IOU. Settle it, or merge them into the right person.`;
    }
  }
  const groups = groupsWith(db, id);
  if (groups.length > 0) return `${name} is in ${groups.map((g) => g.name).join(', ')}. Take them out of the group first.`;
  return null;
}

/** Removes a person added by mistake, or a settled one no longer needed (decision 0020). */
export async function removePerson(id: string): Promise<void> {
  const blocker = await removalBlocker(id);
  if (blocker) throw new Error(blocker);
  const db = await getDb();
  db.update(accounts)
    .set({ deletedAt: new Date().toISOString(), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id))
    .run();
  db.delete(personContacts).where(eq(personContacts.personAccountId, id)).run();
  const aliases = await payeeAliases();
  let changed = false;
  for (const [key, personId] of aliases) if (personId === id && aliases.delete(key)) changed = true;
  if (changed) await saveAliases(aliases);
  notifyLedgerChange();
}

// ---- Same person twice (decision 0020) ----

const DISMISSED_KEY = 'people.not_duplicates';

async function dismissedPairs(): Promise<Set<string>> {
  try {
    const raw = await kvGet(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

export interface DuplicateSuggestion extends DuplicatePair {
  keepName: string;
  removeName: string;
}

/** People who are probably one person, for People to ask about. Pairs the user said are different stay hidden. */
export async function duplicateSuggestions(people?: readonly Person[]): Promise<DuplicateSuggestion[]> {
  const list = people ?? (await listPeople());
  const names = new Map(list.map((p) => [p.account.id, p.account.name]));
  const pairs = findDuplicatePeople(
    list.map((p) => ({ id: p.account.id, name: p.account.name, vpa: p.account.vpa, email: p.account.email })),
    await dismissedPairs(),
  );
  return pairs.map((pair) => ({ ...pair, keepName: names.get(pair.keep) ?? '', removeName: names.get(pair.remove) ?? '' }));
}

/** "Not the same person": stop asking about this pair. Kept on this phone. */
export async function dismissDuplicate(a: string, b: string): Promise<void> {
  const pairs = await dismissedPairs();
  pairs.add(pairKey(a, b));
  await kvSet(DISMISSED_KEY, JSON.stringify([...pairs]));
  notifyLedgerChange();
}
