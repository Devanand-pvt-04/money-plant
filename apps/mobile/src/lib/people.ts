import * as Crypto from 'expo-crypto';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { paise, type Paise } from '@money-plant/core';
import { accounts, ious, personContacts, postings, splitGroups, transactions, type LocalAccount } from '@money-plant/db-schema';
import { findPerson, payeeKey } from '@money-plant/matcher';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { notifyLedgerChange } from './events';
import { isVpa } from './me';

export interface Person {
  account: LocalAccount;
  /** Sum of postings: above zero they owe the user, below zero the user owes them. */
  balance: Paise;
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
    .select({ accountId: postings.accountId, total: sql<number>`sum(${postings.amountPaise})` })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(inArray(postings.accountId, ids), isNull(transactions.deletedAt)))
    .groupBy(postings.accountId)
    .all();
  const totals = new Map(sums.map((s) => [s.accountId, Number(s.total)]));
  const contacts = new Map(db.select().from(personContacts).all().map((c) => [c.personAccountId, c.contactId]));
  return rows.map((account) => ({
    account,
    balance: paise((totals.get(account.id) ?? 0) + account.openingBalancePaise),
    contactId: contacts.get(account.id) ?? null,
  }));
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

async function linkContact(personId: string, contactId: string | null | undefined): Promise<void> {
  if (contactId === undefined) return;
  const db = await getDb();
  db.delete(personContacts).where(eq(personContacts.personAccountId, personId)).run();
  if (contactId) db.insert(personContacts).values({ personAccountId: personId, contactId }).run();
}

export async function createPerson(input: PersonInput): Promise<string> {
  const fields = clean(input);
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
 * (IOU-2); the server asks them to confirm again.
 */
export async function updatePerson(id: string, input: PersonInput): Promise<void> {
  const fields = clean(input);
  const db = await getDb();
  const before = db.select().from(accounts).where(eq(accounts.id, id)).get();
  db.update(accounts)
    .set({ ...fields, dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id))
    .run();
  if (before && before.email !== fields.email) {
    db.update(ious)
      .set({ counterpartyEmail: fields.email, dirty: 1, rev: sql`${ious.rev} + 1` })
      .where(and(eq(ious.personAccountId, id), isNull(ious.deletedAt)))
      .run();
  }
  await linkContact(id, input.contactId);
  notifyLedgerChange();
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

async function saveAliases(aliases: ReadonlyMap<string, string>): Promise<void> {
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
  return db
    .select({ members: splitGroups.memberAccountIds })
    .from(splitGroups)
    .where(isNull(splitGroups.deletedAt))
    .all()
    .some((g) => {
      try {
        return (JSON.parse(g.members) as unknown[]).includes(id);
      } catch {
        return false;
      }
    });
}

/** Removes a person nothing refers to, such as one added by mistake. */
export async function removePerson(id: string): Promise<void> {
  if (await personInUse(id)) throw new Error('They still have entries, IOUs, groups or a friend link, so they stay');
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
