import * as Crypto from 'expo-crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { paise, type Paise } from '@money-plant/core';
import { accounts, ious, personContacts, postings, transactions, type LocalAccount } from '@money-plant/db-schema';
import { findPerson } from '@money-plant/matcher';
import { getDb } from './db';
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

/** The person a payee is, by UPI ID or exact name, or a new one. */
export async function personForPayee(payee: { name: string; vpa: string | null }): Promise<string> {
  const people = await listPeople();
  const found = findPerson(
    people.map((p) => ({ id: p.account.id, name: p.account.name, vpa: p.account.vpa })),
    payee,
  );
  if (found) {
    const person = people.find((p) => p.account.id === found.id)!;
    // Learn their UPI ID from the payment, so the next one is recognised and pay links work.
    if (!person.account.vpa && payee.vpa) await updatePerson(found.id, { name: person.account.name, vpa: payee.vpa, email: person.account.email });
    return found.id;
  }
  return createPerson({ name: payee.name, vpa: payee.vpa && isVpa(payee.vpa) ? payee.vpa : null });
}
