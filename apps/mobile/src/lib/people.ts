import * as Crypto from 'expo-crypto';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DEFAULT_CURRENCY, paise, type CurrencyCode, type Paise } from '@money-plant/core';
import { accounts, itemLinks, personContacts, postings, sharedItems, transactions, type LocalAccount, type LocalPersonIdentifier } from '@money-plant/db-schema';
import { findDuplicatePeople, findPerson, identifierClashes, mobileDigits, normaliseIdentifier, pairKey, type DuplicatePair, type Identifier } from '@money-plant/matcher';
import { getDb } from './db';
import { homeConverter } from './home-money';
import { kvGet, kvSet } from './kv';
import { notifyLedgerChange } from './events';
import { getMe, isVpa } from './me';
import {
  addIdentifiers,
  identifiedPeople,
  identifiersByPerson,
  learnFromPayee,
  matchPersonForPayee,
  removeIdentifiersOf,
  setIdentifiersOfKind,
  toIdentifier,
} from './identity';

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
  /** Everything that identifies them: UPI IDs, phone, bank accounts, payee names (decision 0025). */
  identifiers: LocalPersonIdentifier[];
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
  const identifiers = await identifiersByPerson();
  return rows.map((account) => {
    const balances = [...(totals.get(account.id) ?? [])]
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ currency, amount: paise(amount) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const balance = balances.reduce((sum, b) => sum + (converter.toHome(b.amount, b.currency, at) ?? 0), 0);
    return { account, balance: paise(balance), balances, contactId: contacts.get(account.id) ?? null, identifiers: identifiers.get(account.id) ?? [] };
  });
}

/** A person's UPI IDs besides the one used to pay them, only for recognising their payments (decisions 0021, 0025). */
export const extraVpasOf = (p: Pick<Person, 'account' | 'identifiers'>): string[] =>
  p.identifiers.filter((i) => i.kind === 'upi' && i.value !== p.account.vpa?.toLowerCase()).map((i) => i.value);

/** A person's mobile number (decision 0025: the first one they have). */
export const phoneOf = (p: Pick<Person, 'identifiers'>): string | null => p.identifiers.find((i) => i.kind === 'phone')?.value ?? null;

/** What matching needs to know about a person: name, every UPI ID, phone, and all identifiers. */
export const personRef = (p: Person) => ({
  id: p.account.id,
  name: p.account.name,
  vpa: p.account.vpa,
  email: p.account.email,
  extraVpas: extraVpasOf(p),
  phone: phoneOf(p),
  identifiers: p.identifiers.map(toIdentifier),
});

/** Most UPI IDs one person can have besides the main one (decision 0021). */
export const MAX_EXTRA_VPAS = 10;

export async function getPerson(id: string): Promise<Person | null> {
  return (await listPeople()).find((p) => p.account.id === id) ?? null;
}

export interface PersonInput {
  name: string;
  vpa?: string | null;
  email?: string | null;
  /** Their other UPI IDs; left out keeps what they have. */
  extraVpas?: readonly string[];
  /** Their mobile number in any form ("+91 98765 43210"); left out keeps what they have. */
  phone?: string | null;
  /** Their bank accounts as typed, "HDFC 1234, SBI 5678" (decision 0025); left out keeps what they have. */
  bankAccounts?: string;
  contactId?: string | null;
}

function cleanExtras(vpa: string | null, extras: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of extras) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (!isVpa(v)) throw new Error(`${raw.trim()} isn't a UPI ID like name@okaxis`);
    if (v !== vpa && !out.includes(v)) out.push(v);
  }
  if (out.length > MAX_EXTRA_VPAS) throw new Error(`A person can have up to ${MAX_EXTRA_VPAS} other UPI IDs`);
  return out;
}

function clean(input: PersonInput) {
  const name = input.name.trim();
  if (!name) throw new Error('Enter a name');
  const vpa = input.vpa?.trim().toLowerCase() || null;
  if (vpa && !isVpa(vpa)) throw new Error('Enter a UPI ID like name@okaxis');
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email');
  const extraVpas = input.extraVpas === undefined ? undefined : cleanExtras(vpa, input.extraVpas);
  const phone = input.phone === undefined ? undefined : cleanPhone(input.phone);
  const bankAccounts = input.bankAccounts === undefined ? undefined : parseBankAccounts(input.bankAccounts);
  return { name: name.slice(0, 80), vpa, email, extraVpas, bankAccounts, ...(phone !== undefined ? { phone } : {}) };
}

/**
 * Bank accounts typed in one field (decision 0025): "HDFC 1234, SBI XX5678".
 * Each is a bank name and the account number or its last digits.
 */
export function parseBankAccounts(text: string): Identifier[] {
  const out: Identifier[] = [];
  for (const part of text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const digits = /[xX*]*(\d{3,18})\s*$/.exec(part)?.[1];
    const bank = part.replace(/[xX*]*\d{3,18}\s*$/, '').trim();
    const id = digits ? normaliseIdentifier('bank_account', digits, bank || null) : null;
    if (!id) throw new Error(`Write each account as its bank and number, like HDFC 1234 (not "${part}")`);
    if (!out.some((o) => o.value === id.value && o.label === id.label)) out.push(id);
  }
  return out;
}

/** A bank account as the person screen shows it: "HDFC 1234". */
export const formatBankAccount = (id: Pick<Identifier, 'value' | 'label'>) => `${id.label ? `${id.label.toUpperCase()} ` : ''}${id.value}`;

/** A 10-digit Indian mobile number, or null for none (decision 0021). */
export function cleanPhone(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  const phone = mobileDigits(raw);
  if (!phone) throw new Error('Enter a 10-digit mobile number');
  return phone;
}

/** The account columns: the name, the UPI ID to pay them and their email. Other identifiers live in person_identifiers (decision 0025). */
function columns(fields: ReturnType<typeof clean>) {
  return { name: fields.name, vpa: fields.vpa, email: fields.email };
}

/** Writes the UPI IDs and phone typed on the person screen as identifiers. */
async function writeIdentifiers(personId: string, fields: ReturnType<typeof clean>): Promise<void> {
  const upi = (v: string) => normaliseIdentifier('upi', v);
  if (fields.extraVpas !== undefined) {
    const wanted = [fields.vpa, ...fields.extraVpas].map((v) => (v ? upi(v) : null)).filter((i): i is Identifier => i !== null);
    await setIdentifiersOfKind(personId, ['upi'], wanted);
  } else if (fields.vpa) {
    const pay = upi(fields.vpa);
    if (pay) await addIdentifiers(personId, [pay], 'typed');
  }
  if (fields.phone !== undefined) {
    const phone = fields.phone ? normaliseIdentifier('phone', fields.phone) : null;
    await setIdentifiersOfKind(personId, ['phone'], phone ? [phone] : []);
  }
  if (fields.bankAccounts !== undefined) await setIdentifiersOfKind(personId, ['bank_account'], fields.bankAccounts);
}

/**
 * Decision 0020: two people can't share an email or UPI ID. Carries the
 * other person, so the screen can offer to merge them instead.
 */
export class SamePersonError extends Error {
  constructor(
    readonly other: { id: string; name: string },
    readonly field: 'email' | 'vpa' | 'phone' | 'account',
  ) {
    const what = field === 'email' ? 'email' : field === 'phone' ? 'phone number' : field === 'account' ? 'bank account' : 'UPI ID';
    super(`${other.name} already has this ${what}. If they're the same person, merge them instead.`);
    this.name = 'SamePersonError';
  }
}

async function checkClash(
  self: string | null,
  fields: { email: string | null; vpa: string | null; extraVpas?: readonly string[]; phone?: string | null; bankAccounts?: readonly Identifier[] },
): Promise<void> {
  const people = await identifiedPeople();
  const email = fields.email?.toLowerCase();
  const byEmail = email ? people.find((p) => p.id !== self && p.email?.toLowerCase() === email) : undefined;
  if (byEmail) throw new SamePersonError({ id: byEmail.id, name: byEmail.name }, 'email');
  // Decision 0025: a strong identifier is on one person only.
  const ids = [
    ...[fields.vpa, ...(fields.extraVpas ?? [])].map((v) => (v ? normaliseIdentifier('upi', v) : null)),
    fields.phone ? normaliseIdentifier('phone', fields.phone) : null,
    ...(fields.bankAccounts ?? []),
  ].filter((i): i is Identifier => i !== null);
  const clash = identifierClashes(people, self, ids)[0];
  if (clash) {
    const kind = clash.identifier.kind;
    throw new SamePersonError({ id: clash.person.id, name: clash.person.name }, kind === 'phone' ? 'phone' : kind === 'bank_account' ? 'account' : 'vpa');
  }
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
    .values({ id, type: 'person', ...columns(fields), institution: null, last4: null, openingBalancePaise: 0, createdAt: new Date().toISOString(), dirty: 1 })
    .run();
  await writeIdentifiers(id, fields);
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
  const had = (await identifiersByPerson()).get(id) ?? [];
  const hadVpas = [before?.vpa?.toLowerCase(), ...had.filter((i) => i.kind === 'upi').map((i) => i.value)];
  const hadPhones = had.filter((i) => i.kind === 'phone').map((i) => i.value);
  const hadAccounts = had.filter((i) => i.kind === 'bank_account');
  // Only what changed is checked, so an older pair that already clashes can still be renamed.
  await checkClash(id, {
    email: fields.email !== before?.email ? fields.email : null,
    vpa: fields.vpa && !hadVpas.includes(fields.vpa) ? fields.vpa : null,
    extraVpas: (fields.extraVpas ?? []).filter((v) => !hadVpas.includes(v)),
    phone: fields.phone && !hadPhones.includes(fields.phone) ? fields.phone : null,
    bankAccounts: (fields.bankAccounts ?? []).filter((a) => !hadAccounts.some((h) => h.value === a.value && h.label === a.label)),
  });
  db.update(accounts)
    .set({ ...columns(fields), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id))
    .run();
  await writeIdentifiers(id, fields);
  if (before && before.email !== fields.email) await shareItemsOf(id, fields.email);
  await linkContact(id, input.contactId);
  notifyLedgerChange();
}

/**
 * Decision 0026: the items this user made with a person go to `email`, so a
 * friend with that email sees them (or no one, for null). The server finds
 * the friend from the email and asks again for any share.
 */
export async function shareItemsOf(personId: string, email: string | null): Promise<void> {
  const db = await getDb();
  const me = await getMe();
  const ids = db
    .select({ id: itemLinks.itemId })
    .from(itemLinks)
    .where(and(eq(itemLinks.personAccountId, personId), isNull(itemLinks.deletedAt)))
    .all()
    .map((r) => r.id);
  if (ids.length === 0) return;
  for (const row of db.select().from(sharedItems).where(and(inArray(sharedItems.id, ids), eq(sharedItems.userId, me.id), isNull(sharedItems.deletedAt))).all()) {
    if (row.counterpartyEmail === email) continue;
    db.update(sharedItems)
      .set({ counterpartyEmail: email, counterpartyUserId: null, answer: null, answeredAt: null, dirty: 1, rev: sql`${sharedItems.rev} + 1` })
      .where(eq(sharedItems.id, row.id))
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

/**
 * The person a payee is (decision 0025): a strong identifier, a payee name
 * one person has learned, else a hint by name. Null when no one matches.
 */
export async function findPersonForPayee(payee: { name: string | null; vpa: string | null }): Promise<string | null> {
  const match = await matchPersonForPayee(payee);
  if (match) return match.person.id;
  // Payee names linked before decision 0025 were kept on this phone only.
  const [people, aliases] = await Promise.all([listPeople(), payeeAliases()]);
  return findPerson(people.map(personRef), payee, aliases)?.id ?? null;
}

/**
 * The user said a payment was to or from this person: learn its UPI ID, the
 * number in it, the account and the payee name (decision 0025), so the next
 * payment is recognised. One already on someone else is left alone. The first
 * UPI ID becomes the one to pay them when they have none.
 */
export async function rememberPayee(personId: string, payee: { name: string | null; vpa: string | null }): Promise<void> {
  const db = await getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, personId)).get();
  if (!account) return;
  await learnFromPayee(personId, payee);
  const vpa = payee.vpa?.trim().toLowerCase();
  if (!account.vpa && vpa && isVpa(vpa)) {
    const people = await identifiedPeople();
    const id = normaliseIdentifier('upi', vpa);
    if (id && identifierClashes(people, personId, [id]).length === 0) {
      db.update(accounts).set({ vpa, dirty: 1, rev: sql`${accounts.rev} + 1` }).where(eq(accounts.id, personId)).run();
    }
  }
}

/**
 * Payee names linked on this phone before decision 0025 become learned
 * identifiers, so every phone of the user knows them. Runs once.
 */
export async function migrateAliases(): Promise<void> {
  if (await kvGet(ALIASES_MIGRATED_KEY)) return;
  const db = await getDb();
  const live = new Set(db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.type, 'person'), isNull(accounts.deletedAt))).all().map((r) => r.id));
  for (const [key, personId] of await payeeAliases()) {
    if (!live.has(personId)) continue;
    const id = normaliseIdentifier('payee_name', key);
    if (id) await addIdentifiers(personId, [id], 'learned');
  }
  await kvSet(ALIASES_MIGRATED_KEY, '1');
}

const ALIASES_MIGRATED_KEY = 'people.aliases.migrated';

/** Items with this person that still count: not removed, and not a share declined. */
function liveItemsWith(db: Awaited<ReturnType<typeof getDb>>, id: string) {
  const ids = db
    .select({ id: itemLinks.itemId })
    .from(itemLinks)
    .where(and(eq(itemLinks.personAccountId, id), isNull(itemLinks.deletedAt)))
    .all()
    .map((r) => r.id);
  if (ids.length === 0) return [];
  return db.select().from(sharedItems).where(and(inArray(sharedItems.id, ids), isNull(sharedItems.deletedAt))).all();
}

/** Whether anything refers to this person: an entry, a shared item or a friend link. */
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
  return liveItemsWith(db, id).length > 0;
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
  await removeIdentifiersOf(id);
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
    list.map(personRef),
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
