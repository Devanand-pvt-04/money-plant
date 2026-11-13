import * as Crypto from 'expo-crypto';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { addDays, buildUpiUri, dateOf, DEFAULT_CURRENCY, paise, startOfDate, type CurrencyCode, type DateKey, type Paise } from '@money-plant/core';
import { accounts, itemLinks, sharedItems, transactions, type LocalItemLink, type LocalSharedItem } from '@money-plant/db-schema';
import {
  counterpartCandidates,
  itemStatus,
  ledgerGap,
  linkPostings,
  rebaseOpening,
  shareEntryPostings,
  sharedBalance,
  unlinkPostings,
  viewerFlow,
  type CandidateEntry,
  type ItemFlow,
  type ItemKind,
  type ItemStatus,
  type LedgerPosting,
  type LedgerTransaction,
  type SharedItem,
} from '@money-plant/matcher';
import { formatAmount } from '@/components/format';
import { flatten, listCategories, ownedAccountIds } from './categories';
import { getDb, type Database } from './db';
import { notifyLedgerChange } from './events';
import { FRIEND_EMAILS_KEY } from './friends';
import { homeCurrency } from './home-currency';
import { derivedId } from './ids';
import { kvGet } from './kv';
import { loadTransactions, SqliteLedgerStore, systemAccountId, writeTransaction } from './ledger-store';
import { displayName, getMe, type Me } from './me';
import { findPersonForPayee, listPeople, rememberPayee, type Person } from './people';
import { syncNow } from './sync';

/**
 * Decision 0026 on the phone: shared items (shares, loans, repayments) and
 * this user's links from them to their own ledger. Each phone writes only its
 * own money: a share where value came to the user is spending plus "I owe"
 * with no bank leg; everything else links the user's own bank entry, whose
 * bank leg never changes.
 */

const now = () => new Date().toISOString();
/** Shared items should reach the other person quickly, so changes go up without waiting for the next sync. */
export const pushSoon = () => void syncNow().catch(() => {});

export type { ItemFlow, ItemKind, ItemStatus } from '@money-plant/matcher';

export interface ItemView extends SharedItem {
  reason: string | null;
  categoryName: string | null;
  /** Ties the shares of one bill split with several people (step 4). */
  groupRef: string | null;
  /** A repayment settled another way: no money moved (decision 0027). */
  settledOutside: boolean;
  createdAt: string;
  /** This user's person for the other side; null when the friend isn't a person here yet. */
  personId: string | null;
  personName: string;
  /** The email it is shared with, on the creator's side. */
  sharedWith: string | null;
  link: LocalItemLink | null;
  /** This user's entry for it, once linked. */
  transactionId: string | null;
  status: ItemStatus;
}

const linkIdFor = (itemId: string) => derivedId(`item-link:${itemId}`);

async function friendEmails(): Promise<Map<string, string>> {
  try {
    const parsed: unknown = JSON.parse((await kvGet(FRIEND_EMAILS_KEY)) ?? '{}');
    return new Map(Object.entries(parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}));
  } catch {
    return new Map();
  }
}

/** The answer this user sees: their own one waiting to be sent wins over the server's. */
const answerOf = (row: LocalSharedItem, mine: boolean) => (mine ? row.answer : (row.myAnswer ?? row.answer));

function toView(row: LocalSharedItem, meId: string, link: LocalItemLink | undefined, person: Person | undefined): ItemView {
  const mine = row.userId === meId;
  const answer = answerOf(row, mine);
  const base = {
    id: row.id,
    kind: row.kind,
    flow: viewerFlow(row.flow, mine),
    amount: paise(row.amountPaise),
    currency: row.currency as CurrencyCode,
    occurredOn: row.occurredOn as DateKey,
    answer,
    mine,
    // A friend's item reached this user, so only the creator's side can be one-sided.
    oneSided: mine && row.counterpartyUserId === null,
  };
  const transactionId = link && !link.deletedAt ? link.transactionId : null;
  return {
    ...base,
    reason: row.reason,
    categoryName: row.categoryName,
    groupRef: row.groupRef,
    settledOutside: row.settledOutside,
    createdAt: row.createdAt,
    personId: person?.account.id ?? null,
    personName: person?.account.name ?? 'A friend',
    sharedWith: mine ? row.counterpartyEmail : null,
    link: link ?? null,
    transactionId,
    status: itemStatus(base, transactionId !== null),
  };
}

/** Every item this user can see, newest first. */
export async function listItems(): Promise<ItemView[]> {
  const db = await getDb();
  const [me, people, emails] = await Promise.all([getMe(), listPeople(), friendEmails()]);
  const rows = db.select().from(sharedItems).where(isNull(sharedItems.deletedAt)).all();
  if (rows.length === 0) return [];
  const links = new Map(
    db
      .select()
      .from(itemLinks)
      .where(inArray(itemLinks.itemId, rows.map((r) => r.id)))
      .all()
      .map((l) => [l.itemId, l]),
  );
  const byId = new Map(people.map((p) => [p.account.id, p]));
  return rows
    .map((row) => {
      const link = links.get(row.id);
      let person = link ? byId.get(link.personAccountId) : undefined;
      if (!person && row.userId !== me.id) {
        const email = emails.get(row.userId);
        person = email ? people.find((p) => p.account.email === email) : undefined;
      }
      return toView(row, me.id, link, person);
    })
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt));
}

export async function getItem(id: string): Promise<ItemView | null> {
  return (await listItems()).find((v) => v.id === id) ?? null;
}

/** Items with one person, newest first. */
export async function itemsWith(personId: string): Promise<ItemView[]> {
  return (await listItems()).filter((v) => v.personId === personId);
}

// ---- Entries ----

async function loadTx(db: Database, id: string): Promise<LedgerTransaction | null> {
  const [tx] = loadTransactions(db, db.select().from(transactions).where(and(eq(transactions.id, id), isNull(transactions.deletedAt))).all());
  return tx ?? null;
}

function peopleIds(db: Database): Set<string> {
  return new Set(db.select({ id: accounts.id }).from(accounts).where(eq(accounts.type, 'person')).all().map((a) => a.id));
}

/** Money in or out of the user's own accounts, by kind of what is left on the other side. */
function kindAfter(postingsLeft: readonly LedgerPosting[], owned: ReadonlySet<string>, people: ReadonlySet<string>): LedgerTransaction['kind'] {
  const hasCategory = postingsLeft.some((p) => !owned.has(p.accountId) && !people.has(p.accountId));
  if (!hasCategory) return 'iou';
  const own = postingsLeft.filter((p) => owned.has(p.accountId)).reduce((s, p) => s + p.amount, 0);
  return own > 0 ? 'income' : 'expense';
}

const withField = (fields: LedgerTransaction['userSetFields'], ...add: LedgerTransaction['userSetFields']) => [...new Set([...fields, ...add])];

function softDelete(db: Database, id: string): void {
  db.update(transactions).set({ deletedAt: now(), dirty: 1, rev: sql`${transactions.rev} + 1` }).where(eq(transactions.id, id)).run();
}

function setLink(db: Database, linkId: string, fields: Partial<LocalItemLink>): void {
  db.update(itemLinks).set({ ...fields, dirty: 1, rev: sql`${itemLinks.rev} + 1` }).where(eq(itemLinks.id, linkId)).run();
}

/** Makes sure this user has a link row for the item, pointing at `personId`. */
async function ensureLink(db: Database, itemId: string, personId: string): Promise<LocalItemLink> {
  const id = await linkIdFor(itemId);
  const existing = db.select().from(itemLinks).where(eq(itemLinks.id, id)).get();
  if (existing) {
    if (existing.personAccountId !== personId || existing.deletedAt) setLink(db, id, { personAccountId: personId, deletedAt: null });
    return db.select().from(itemLinks).where(eq(itemLinks.id, id)).get()!;
  }
  db.insert(itemLinks).values({ id, itemId, personAccountId: personId, createdAt: now(), dirty: 1 }).run();
  return db.select().from(itemLinks).where(eq(itemLinks.id, id)).get()!;
}

const linkedFields = (view: Pick<ItemView, 'kind' | 'flow' | 'amount' | 'currency'>) => ({
  linkedKind: view.kind,
  linkedFlow: view.flow,
  linkedPaise: view.amount as number,
  linkedCurrency: view.currency as string,
});

/** The payee of an entry as the bank wrote it. */
function payeeOf(tx: LedgerTransaction): { name: string | null; vpa: string | null } {
  const vpa = tx.sources.find((s) => s.kind === 'sms')?.parsedFields.vpa;
  return { name: tx.counterparty, vpa: typeof vpa === 'string' ? vpa : null };
}

/**
 * Moves the item's amount on one of the user's entries to the person. The
 * bank leg stays as it is, so the account balance is still what the bank says.
 */
async function linkInto(db: Database, view: ItemView, personId: string, transactionId: string): Promise<void> {
  const tx = await loadTx(db, transactionId);
  if (!tx) throw new Error('Entry not found');
  const owned = ownedAccountIds(db);
  const next = linkPostings(tx.postings, owned, view, personId, () => Crypto.randomUUID());
  const people = peopleIds(db);
  writeTransaction(db, {
    ...tx,
    kind: kindAfter(next, owned, people),
    status: 'confirmed',
    reviewReason: null,
    userSetFields: withField(tx.userSetFields, 'category'),
    postings: next,
  });
  const link = await ensureLink(db, view.id, personId);
  setLink(db, link.id, { transactionId, ...linkedFields(view) });
  // Money from them is from their own account, so the payee is them. Money out is often paid to a shop for them.
  if (view.flow === 'to_me' && view.kind !== 'share') await rememberPayee(personId, payeeOf(tx));
}

/** A loan or repayment entry the user typed for an item: one of their accounts and the person, nothing else. */
const isTypedEntry = (tx: LedgerTransaction, owned: ReadonlySet<string>, personId: string) =>
  tx.kind === 'iou' &&
  tx.postings.length === 2 &&
  tx.sources.length > 0 &&
  tx.sources.every((s) => s.kind === 'manual') &&
  tx.postings.some((p) => owned.has(p.accountId)) &&
  tx.postings.some((p) => p.accountId === personId);

/**
 * Takes back what a link put on its entry. The entry the app made for a
 * share (no bank leg) goes. A bank entry gets the amount back on the category
 * it came from, or on Uncategorised, which sends it to Review.
 */
async function undoLink(db: Database, link: LocalItemLink): Promise<void> {
  const clear = () => setLink(db, link.id, { transactionId: null, linkedKind: null, linkedFlow: null, linkedPaise: null, linkedCurrency: null });
  const tx = link.transactionId ? await loadTx(db, link.transactionId) : null;
  if (!tx || link.linkedPaise === null || !link.linkedFlow || !link.linkedCurrency) return clear();
  const owned = ownedAccountIds(db);
  const people = peopleIds(db);
  if (!tx.postings.some((p) => owned.has(p.accountId))) {
    softDelete(db, tx.id);
    return clear();
  }
  // A payment typed only for this item goes with it.
  if (isTypedEntry(tx, owned, link.personAccountId)) {
    softDelete(db, tx.id);
    const store = new SqliteLedgerStore(db);
    for (const p of tx.postings) if (owned.has(p.accountId)) await rebaseOpening(store, p.accountId);
    return clear();
  }
  const carried = { flow: link.linkedFlow, amount: paise(link.linkedPaise), currency: link.linkedCurrency as CurrencyCode };
  const sign = carried.flow === 'to_them' ? 1 : -1;
  const home = tx.postings
    .filter((p) => !owned.has(p.accountId) && !people.has(p.accountId) && (p.currency ?? DEFAULT_CURRENCY) === carried.currency && Math.sign(p.amount) === sign)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  const fallbackId = home?.accountId ?? (await systemAccountId(sign > 0 ? 'uncategorised_expense' : 'uncategorised_income'));
  const next = unlinkPostings(tx.postings, carried, link.personAccountId, fallbackId, () => Crypto.randomUUID());
  if (next.length < 2) softDelete(db, tx.id);
  else {
    writeTransaction(db, {
      ...tx,
      kind: kindAfter(next, owned, people),
      ...(home ? {} : { status: 'pending' as const, reviewReason: 'person' as const, userSetFields: tx.userSetFields.filter((f) => f !== 'category') }),
      postings: next,
    });
  }
  clear();
}

/** The spending category a share lands on: one with the creator's category name, else Uncategorised. */
async function categoryFor(name: string | null): Promise<string> {
  if (name) {
    const wanted = name.trim().toLowerCase();
    const match = flatten(await listCategories()).find((c) => c.flow === 'expense' && c.name.trim().toLowerCase() === wanted);
    if (match) return match.id;
  }
  return systemAccountId('uncategorised_expense');
}

/** A share where value came to the user: spending on the category, owed to the person, no bank leg. */
async function makeShareEntry(db: Database, view: ItemView, personId: string, personName: string, categoryId: string): Promise<void> {
  const id = Crypto.randomUUID();
  writeTransaction(db, {
    id,
    // Noon keeps it on its day in any time zone.
    occurredAt: new Date(`${view.occurredOn}T12:00:00`).toISOString(),
    counterparty: personName,
    kind: 'expense',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: ['category', 'amount', 'occurredAt', 'kind'],
    note: view.reason,
    postings: shareEntryPostings(view, categoryId, personId, () => Crypto.randomUUID()),
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'manual',
        sender: null,
        externalRef: null,
        fingerprint: `manual:${id}`,
        parsedFields: { share: view.id, amount: view.amount, counterparty: personName },
        receivedAt: now(),
        confidence: 1,
        rawText: null,
      },
    ],
  });
  const link = await ensureLink(db, view.id, personId);
  setLink(db, link.id, { transactionId: id, ...linkedFields(view) });
}

/** A loan or repayment typed by hand: money out of or into one of the user's accounts, owed by or to the person. */
async function makeTypedEntry(db: Database, view: ItemView, personId: string, personName: string, accountId: string, occurredAt: string): Promise<void> {
  if (!ownedAccountIds(db).has(accountId)) throw new Error('Pick one of your accounts');
  const currency = db.select({ currency: accounts.currency }).from(accounts).where(eq(accounts.id, accountId)).get()?.currency;
  if (currency && currency !== view.currency) throw new Error(`Pick an account in ${view.currency}`);
  const own = paise(view.flow === 'to_them' ? -view.amount : view.amount);
  const id = Crypto.randomUUID();
  writeTransaction(db, {
    id,
    occurredAt,
    counterparty: personName,
    kind: 'iou',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: ['category', 'amount', 'account', 'occurredAt', 'kind'],
    note: view.reason,
    postings: [
      { id: Crypto.randomUUID(), accountId, amount: own, currency: view.currency },
      { id: Crypto.randomUUID(), accountId: personId, amount: paise(-own), currency: view.currency },
    ],
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'manual',
        sender: null,
        externalRef: null,
        fingerprint: `manual:${id}`,
        parsedFields: { direction: own < 0 ? 'debit' : 'credit', amount: view.amount, counterparty: personName },
        receivedAt: now(),
        confidence: 1,
        rawText: null,
      },
    ],
  });
  await rebaseOpening(new SqliteLedgerStore(db), accountId);
  const link = await ensureLink(db, view.id, personId);
  setLink(db, link.id, { transactionId: id, ...linkedFields(view) });
}

/**
 * The hidden account a debt settled another way is written against (decision
 * 0027): not one of the user's accounts, not spending or income. One per user,
 * with an id derived from the user's id, so every device makes the same one.
 */
async function settledAccountId(db: Database): Promise<string> {
  const id = await derivedId('system:settled');
  const existing = db.select({ id: accounts.id, deletedAt: accounts.deletedAt }).from(accounts).where(eq(accounts.id, id)).get();
  if (!existing) {
    db.insert(accounts)
      .values({ id, type: 'settled', name: 'Settled outside the app', institution: null, last4: null, openingBalancePaise: 0, createdAt: now(), dirty: 1 })
      .run();
  }
  return id;
}

/** A repayment settled another way: the person's balance moves against the hidden settled account, and no account of the user's changes. */
async function makeOutsideEntry(db: Database, view: ItemView, personId: string, personName: string): Promise<void> {
  if (view.kind !== 'repayment') throw new Error('Only a repayment can be settled another way');
  const settled = await settledAccountId(db);
  // Paid back to the user ('to_me'): what the person owes goes down.
  const person = paise(view.flow === 'to_me' ? -view.amount : view.amount);
  const id = Crypto.randomUUID();
  writeTransaction(db, {
    id,
    occurredAt: new Date(`${view.occurredOn}T12:00:00`).toISOString(),
    counterparty: personName,
    kind: 'iou',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: ['category', 'amount', 'account', 'occurredAt', 'kind'],
    note: view.reason,
    postings: [
      { id: Crypto.randomUUID(), accountId: personId, amount: person, currency: view.currency },
      { id: Crypto.randomUUID(), accountId: settled, amount: paise(-person), currency: view.currency },
    ],
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'manual',
        sender: null,
        externalRef: null,
        fingerprint: `manual:${id}`,
        parsedFields: { settled: view.id, amount: view.amount, counterparty: personName },
        receivedAt: now(),
        confidence: 1,
        rawText: null,
      },
    ],
  });
  const link = await ensureLink(db, view.id, personId);
  setLink(db, link.id, { transactionId: id, ...linkedFields(view) });
}

async function requireView(id: string): Promise<ItemView> {
  const view = await getItem(id);
  if (!view) throw new Error('Not found');
  return view;
}

async function requirePerson(personId: string): Promise<Person> {
  const person = (await listPeople()).find((p) => p.account.id === personId);
  if (!person) throw new Error('Person not found');
  return person;
}

// ---- Creating and changing items (the creator) ----

/** Where the creator's side of a new item comes from. */
export type EntrySide =
  /** One of the user's entries (a bank SMS, a statement row). */
  | { transactionId: string }
  /** A loan or repayment typed by hand on one of the user's accounts. */
  | { accountId: string; occurredAt: string }
  /** A share the other person paid: the user's spending on this category. */
  | { categoryId: string }
  /** A repayment settled another way: no money moved (decision 0027). In the person's balance currency; home when left out. */
  | { outside: true; currency?: CurrencyCode }
  /** Linked later. */
  | null;

export interface NewItem {
  personId: string;
  kind: ItemKind;
  /** From the user's side. */
  flow: ItemFlow;
  amount: Paise;
  occurredOn: DateKey;
  reason: string | null;
  /** The shares of one bill split with several people share this id (decision 0026, step 4). */
  groupRef?: string | null;
}

/** The currency an item takes from where its money is. */
async function currencyOf(db: Database, side: EntrySide): Promise<CurrencyCode> {
  if (side && 'transactionId' in side) {
    const tx = await loadTx(db, side.transactionId);
    const owned = ownedAccountIds(db);
    const own = tx?.postings.find((p) => owned.has(p.accountId));
    if (own?.currency) return own.currency;
  }
  if (side && 'accountId' in side) {
    const currency = db.select({ currency: accounts.currency }).from(accounts).where(eq(accounts.id, side.accountId)).get()?.currency;
    if (currency) return currency as CurrencyCode;
  }
  if (side && 'outside' in side && side.currency) return side.currency;
  return homeCurrency();
}

/** The category name a share suggests to the other person: the biggest spending leg of the user's entry. */
async function categoryNameOf(db: Database, side: EntrySide): Promise<string | null> {
  let id: string | null = null;
  if (side && 'categoryId' in side) id = side.categoryId;
  else if (side && 'transactionId' in side) {
    const tx = await loadTx(db, side.transactionId);
    const owned = ownedAccountIds(db);
    const people = peopleIds(db);
    id = tx?.postings.filter((p) => !owned.has(p.accountId) && !people.has(p.accountId) && p.amount > 0).sort((a, b) => b.amount - a.amount)[0]?.accountId ?? null;
  }
  if (!id) return null;
  const node = flatten(await listCategories()).find((c) => c.id === id);
  return node && !node.system ? node.name.slice(0, 60) : null;
}

/** Records a share, loan or repayment with someone, with the user's side of it. */
export async function createItem(input: NewItem, side: EntrySide): Promise<string> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter an amount above zero');
  if (side && 'categoryId' in side && !(input.kind === 'share' && input.flow === 'to_me')) throw new Error('Only a share someone else paid needs a category');
  const outside = side !== null && 'outside' in side;
  if (outside && input.kind !== 'repayment') throw new Error('Only paying back can be settled another way');
  const db = await getDb();
  const [me, person] = await Promise.all([getMe(), requirePerson(input.personId)]);
  const id = Crypto.randomUUID();
  const currency = await currencyOf(db, side);
  db.insert(sharedItems)
    .values({
      id,
      userId: me.id,
      kind: input.kind,
      flow: input.flow,
      amountPaise: input.amount,
      currency,
      occurredOn: input.occurredOn,
      reason: input.reason?.trim().slice(0, 120) || null,
      categoryName: input.kind === 'share' ? await categoryNameOf(db, side) : null,
      groupRef: input.groupRef ?? null,
      settledOutside: outside,
      counterpartyEmail: person.account.email,
      createdAt: now(),
      dirty: 1,
    })
    .run();
  await ensureLink(db, id, person.account.id);
  const view = await requireView(id);
  try {
    if (side && 'transactionId' in side) await linkInto(db, view, person.account.id, side.transactionId);
    else if (side && 'accountId' in side) await makeTypedEntry(db, view, person.account.id, person.account.name, side.accountId, side.occurredAt);
    else if (side && 'categoryId' in side) await makeShareEntry(db, view, person.account.id, person.account.name, side.categoryId);
    else if (outside) await makeOutsideEntry(db, view, person.account.id, person.account.name);
  } catch (e) {
    // Nothing half-made: the item goes again, before it was ever sent.
    db.delete(sharedItems).where(eq(sharedItems.id, id)).run();
    db.delete(itemLinks).where(eq(itemLinks.itemId, id)).run();
    throw e;
  }
  notifyLedgerChange();
  pushSoon();
  return id;
}

/**
 * Step 4: one bill split with several people, one share each, tied together
 * by a group ref and settled person by person. With an entry, every share
 * comes off its category; what is left there is the user's own part.
 */
export async function createSplit(
  input: { shares: readonly { personId: string; amount: Paise }[]; occurredOn: DateKey; reason: string | null },
  transactionId: string | null,
): Promise<string[]> {
  const shares = input.shares.filter((s) => s.amount > 0);
  if (shares.length === 0) throw new Error('Pick who it is with');
  if (new Set(shares.map((s) => s.personId)).size !== shares.length) throw new Error('Pick each person once');
  if (transactionId) {
    const db = await getDb();
    const tx = await loadTx(db, transactionId);
    if (!tx) throw new Error('Entry not found');
    const owned = ownedAccountIds(db);
    const people = peopleIds(db);
    const left = tx.postings.filter((p) => !owned.has(p.accountId) && !people.has(p.accountId) && p.amount > 0).reduce((s, p) => s + p.amount, 0);
    const total = shares.reduce((s, x) => s + x.amount, 0);
    const currency = tx.postings.find((p) => owned.has(p.accountId))?.currency;
    if (total > left) throw new Error(`The shares add up to ${formatAmount(total, currency)}, more than the ${formatAmount(left, currency)} left on this entry`);
  }
  const groupRef = shares.length > 1 ? Crypto.randomUUID() : null;
  const made: string[] = [];
  try {
    for (const share of shares) {
      made.push(
        await createItem(
          { personId: share.personId, kind: 'share', flow: 'to_them', amount: share.amount, occurredOn: input.occurredOn, reason: input.reason, groupRef },
          transactionId ? { transactionId } : null,
        ),
      );
    }
  } catch (e) {
    // All or none: the shares already made go again.
    for (const id of made) await deleteItem(id).catch(() => {});
    throw e;
  }
  return made;
}

/** The other shares of the same bill, on the creator's phone (a friend sees only their own). */
export async function sameBill(view: Pick<ItemView, 'id' | 'groupRef'>): Promise<ItemView[]> {
  if (!view.groupRef) return [];
  return (await listItems()).filter((v) => v.groupRef === view.groupRef && v.id !== view.id);
}

/**
 * The creator changes an item. A new amount asks a friend again (the server
 * clears their answer), and this user's own entry carries the new amount.
 */
export async function updateItem(id: string, changes: { amount?: Paise; reason?: string | null; occurredOn?: DateKey }): Promise<void> {
  const db = await getDb();
  const view = await requireView(id);
  if (!view.mine) throw new Error('Only the person who added this can change it');
  if (changes.amount !== undefined && (!Number.isSafeInteger(changes.amount) || changes.amount <= 0)) throw new Error('Enter an amount above zero');
  const amountChanged = changes.amount !== undefined && changes.amount !== view.amount;
  db.update(sharedItems)
    .set({
      ...(changes.amount !== undefined ? { amountPaise: changes.amount } : {}),
      ...(changes.reason !== undefined ? { reason: changes.reason?.trim().slice(0, 120) || null } : {}),
      ...(changes.occurredOn !== undefined ? { occurredOn: changes.occurredOn } : {}),
      ...(amountChanged ? { answer: null, answeredAt: null } : {}),
      dirty: 1,
      rev: sql`${sharedItems.rev} + 1`,
    })
    .where(eq(sharedItems.id, id))
    .run();
  if (amountChanged) await reconcileItems();
  notifyLedgerChange();
  pushSoon();
}

/** The creator removes an item added by mistake. Their entry gets its category back; an entry the app made goes. */
export async function deleteItem(id: string): Promise<void> {
  const db = await getDb();
  const view = await requireView(id);
  if (!view.mine) throw new Error('Only the person who added this can remove it');
  db.update(sharedItems).set({ deletedAt: now(), dirty: 1, rev: sql`${sharedItems.rev} + 1` }).where(eq(sharedItems.id, id)).run();
  if (view.link) {
    await undoLink(db, view.link);
    setLink(db, view.link.id, { deletedAt: now() });
  }
  notifyLedgerChange();
  pushSoon();
}

// ---- The other side ----

/**
 * A friend's share: accepting a share where value came to this user adds
 * their spending and what they owe (on the creator's category when they have
 * one by that name). Declining leaves the ledger alone. The answer reaches
 * the server on the next sync, through answer_shared_item.
 */
export async function answerItem(id: string, accept: boolean, categoryId?: string): Promise<void> {
  const db = await getDb();
  const view = await requireView(id);
  if (view.mine || view.kind !== 'share') throw new Error('Only a share a friend added can be answered');
  if (accept && !view.personId) throw new Error('This friend isn\'t in your People yet. Pull down on People to sync, then try again.');
  const answer: 'accepted' | 'declined' = accept ? 'accepted' : 'declined';
  db.update(sharedItems).set({ myAnswer: answer }).where(eq(sharedItems.id, id)).run();
  const answered = { ...view, answer };
  if (!accept) {
    if (view.link?.transactionId) await undoLink(db, view.link);
  } else if (view.flow === 'to_me' && !view.transactionId) {
    const person = await requirePerson(view.personId!);
    await makeShareEntry(db, answered, person.account.id, person.account.name, categoryId ?? (await categoryFor(view.categoryName)));
  } else if (view.personId) {
    await ensureLink(db, id, view.personId);
  }
  notifyLedgerChange();
  pushSoon();
}

/** Links one of the user's entries to an item: their side of a loan, a repayment, or a share they paid. */
export async function linkEntry(id: string, transactionId: string): Promise<void> {
  const db = await getDb();
  const view = await requireView(id);
  if (!view.personId) throw new Error('This friend isn\'t in your People yet. Pull down on People to sync, then try again.');
  if (view.kind === 'share' && view.flow === 'to_me') throw new Error('A share someone else paid needs no bank entry of yours');
  if (view.settledOutside) throw new Error('This was settled another way, so no payment goes with it');
  if (view.link?.transactionId) await undoLink(db, view.link);
  await linkInto(db, view, view.personId, transactionId);
  notifyLedgerChange();
  pushSoon();
}

/** The user's side typed by hand: money out of or into one of their accounts, for a loan or repayment the app didn't see. */
export async function recordEntry(id: string, accountId: string, occurredAt: string): Promise<void> {
  const db = await getDb();
  const view = await requireView(id);
  if (!view.personId) throw new Error('This friend isn\'t in your People yet. Pull down on People to sync, then try again.');
  if (view.kind === 'share') throw new Error('Link the bank entry you paid with instead');
  if (view.settledOutside) throw new Error('This was settled another way, so no payment goes with it');
  const person = await requirePerson(view.personId);
  if (view.link?.transactionId) await undoLink(db, view.link);
  await makeTypedEntry(db, view, person.account.id, person.account.name, accountId, occurredAt);
  notifyLedgerChange();
  pushSoon();
}

/** Takes the item off the user's entry again; the entry keeps its bank leg and gets its category back. */
export async function unlinkEntry(id: string): Promise<void> {
  const db = await getDb();
  const view = await requireView(id);
  if (!view.link?.transactionId) return;
  await undoLink(db, view.link);
  notifyLedgerChange();
  pushSoon();
}

// ---- Finding the user's side ----

const CANDIDATE_DAYS = 3;

/** Entries that already carry an item or a person. */
function takenIds(db: Database, txIds: readonly string[], people: ReadonlySet<string>, loaded: readonly LedgerTransaction[]): Set<string> {
  const linked = new Set(
    db
      .select({ id: itemLinks.transactionId })
      .from(itemLinks)
      .where(and(isNull(itemLinks.deletedAt), inArray(itemLinks.transactionId, [...txIds])))
      .all()
      .map((r) => r.id)
      .filter((r): r is string => r !== null),
  );
  for (const tx of loaded) if (tx.postings.some((p) => people.has(p.accountId))) linked.add(tx.id);
  return linked;
}

type Entry = CandidateEntry & { tx: LedgerTransaction };

/** The user's entries in a range of days, as candidates (payeeIsPerson left false). */
async function candidateEntries(db: Database, from: DateKey, to: DateKey): Promise<Entry[]> {
  const rows = db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ['expense', 'income']),
        gte(transactions.occurredAt, new Date(startOfDate(from)).toISOString()),
        lt(transactions.occurredAt, new Date(startOfDate(addDays(to, 1))).toISOString()),
      ),
    )
    .all();
  const txs = loadTransactions(db, rows);
  const owned = ownedAccountIds(db);
  const people = peopleIds(db);
  const taken = takenIds(
    db,
    txs.map((t) => t.id),
    people,
    txs,
  );
  const out: Entry[] = [];
  for (const tx of txs) {
    const own = tx.postings.filter((p) => owned.has(p.accountId));
    if (own.length === 0) continue;
    const currency = (own[0]!.currency ?? DEFAULT_CURRENCY) as CurrencyCode;
    out.push({
      id: tx.id,
      day: dateOf(tx.occurredAt),
      ownAmount: paise(own.filter((p) => (p.currency ?? DEFAULT_CURRENCY) === currency).reduce((s, p) => s + p.amount, 0)),
      currency,
      taken: taken.has(tx.id),
      payeeIsPerson: false,
      tx,
    });
  }
  return out;
}

/** Entries that fit an item, the person's own payments first (their payee looked up only for these few). */
async function fitting(db: Database, view: Pick<ItemView, 'kind' | 'flow' | 'amount' | 'currency' | 'occurredOn' | 'personId'>): Promise<Entry[]> {
  const entries = await candidateEntries(db, addDays(view.occurredOn, -CANDIDATE_DAYS), addDays(view.occurredOn, CANDIDATE_DAYS));
  const fits = counterpartCandidates(entries, view, CANDIDATE_DAYS);
  for (const e of fits) e.payeeIsPerson = view.personId !== null && (await findPersonForPayee(payeeOf(e.tx)).catch(() => null)) === view.personId;
  return counterpartCandidates(fits, view, CANDIDATE_DAYS);
}

/** The user's entries that could be their side of an item: right direction, the amount, within 3 days; the person's payments first. */
export async function candidatesFor(id: string): Promise<LedgerTransaction[]> {
  const view = await requireView(id);
  if (view.kind === 'share' && view.flow === 'to_me') return [];
  return (await fitting(await getDb(), view)).map((e) => e.tx);
}

/** Before an item exists: the user's entries that could be their side of it, for the new item form. */
export async function entriesFitting(input: Pick<NewItem, 'kind' | 'flow' | 'amount' | 'occurredOn'> & { personId: string | null }): Promise<LedgerTransaction[]> {
  if (input.kind === 'share' && input.flow === 'to_me') return [];
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return [];
  return (await fitting(await getDb(), { ...input, currency: homeCurrency() })).map((e) => e.tx);
}

/** One open item an entry may be the user's side of, for Review. */
export interface ItemGuess {
  itemId: string;
  name: string;
  kind: ItemKind;
  /** From the user's side. */
  flow: ItemFlow;
}

/** For Review: entries that are probably the user's side of an item waiting for one. */
export async function itemGuesses(txs: readonly LedgerTransaction[]): Promise<Map<string, ItemGuess>> {
  const out = new Map<string, ItemGuess>();
  const waiting = (await listItems()).filter((v) => v.status === 'needs_link' && v.personId && !v.settledOutside && !(v.kind === 'share' && v.flow === 'to_me'));
  if (waiting.length === 0 || txs.length === 0) return out;
  const db = await getDb();
  const owned = ownedAccountIds(db);
  const people = peopleIds(db);
  const taken = takenIds(
    db,
    txs.map((t) => t.id),
    people,
    txs,
  );
  for (const view of waiting) {
    const entries = txs
      .map((tx) => {
        const own = tx.postings.filter((p) => owned.has(p.accountId) && (p.currency ?? DEFAULT_CURRENCY) === view.currency);
        return {
          id: tx.id,
          day: dateOf(tx.occurredAt),
          ownAmount: paise(own.reduce((s, p) => s + p.amount, 0)),
          currency: view.currency,
          taken: own.length === 0 || taken.has(tx.id) || out.has(tx.id),
          payeeIsPerson: false,
        };
      })
      .filter((e) => !e.taken);
    const [best] = counterpartCandidates(entries, view, CANDIDATE_DAYS);
    if (best) out.set(best.id, { itemId: view.id, name: view.personName, kind: view.kind, flow: view.flow });
  }
  return out;
}

// ---- Keeping the ledger in step with the shared rows ----

let reconciling: Promise<number> | null = null;

/**
 * Runs after each sync and after the user changes an item. For every link
 * whose item changed under it, the entry is brought back in step:
 * - the item was removed, or taken away from this user: the link is undone;
 * - a friend's share this user hasn't accepted (asked again after a change), or the user's own share a friend declined: undone;
 * - a new amount, kind or flow: undone, then linked again to the same entry when it still fits.
 * Loans and repayments waiting for this user's side link on their own when
 * exactly one entry fits and its payee is that person. Returns how many
 * links changed.
 */
export function reconcileItems(): Promise<number> {
  reconciling ??= (async () => {
    try {
      return await reconcile();
    } finally {
      reconciling = null;
    }
  })();
  return reconciling;
}

async function reconcile(): Promise<number> {
  const db = await getDb();
  const me = await getMe();
  let changed = 0;
  const links = db.select().from(itemLinks).where(isNull(itemLinks.deletedAt)).all();
  const rows = new Map(
    db
      .select()
      .from(sharedItems)
      .where(inArray(sharedItems.id, links.map((l) => l.itemId)))
      .all()
      .map((r) => [r.id, r]),
  );
  for (const link of links) {
    const row = rows.get(link.itemId);
    if (!row || row.deletedAt) {
      if (link.transactionId) await undoLink(db, link);
      setLink(db, link.id, { deletedAt: now() });
      changed++;
      continue;
    }
    if (!link.transactionId) continue;
    const mine = row.userId === me.id;
    const answer = answerOf(row, mine);
    const flow = viewerFlow(row.flow, mine);
    const stale = row.kind === 'share' && (mine ? answer === 'declined' : answer !== 'accepted');
    const moved = link.linkedKind !== row.kind || link.linkedFlow !== flow || link.linkedPaise !== row.amountPaise || link.linkedCurrency !== row.currency;
    if (!stale && !moved) continue;
    const tx = await loadTx(db, link.transactionId);
    const owned = ownedAccountIds(db);
    // A loan or repayment typed for the item: the typed payment takes the new amount.
    if (!stale && tx && row.kind !== 'share' && isTypedEntry(tx, owned, link.personAccountId)) {
      const view = (await getItem(row.id))!;
      const own = paise(view.flow === 'to_them' ? -view.amount : view.amount);
      const ownLeg = tx.postings.find((p) => owned.has(p.accountId))!;
      writeTransaction(db, {
        ...tx,
        postings: tx.postings.map((p) => ({ ...p, amount: p === ownLeg ? own : paise(-own), currency: view.currency })),
      });
      await rebaseOpening(new SqliteLedgerStore(db), ownLeg.accountId);
      setLink(db, link.id, linkedFields(view));
      changed++;
      continue;
    }
    const madeByApp = tx !== null && !tx.postings.some((p) => owned.has(p.accountId));
    // The user's own share someone else paid: the entry the app made just takes the new amount.
    const keepCategory = madeByApp && tx ? tx.postings.find((p) => p.accountId !== link.personAccountId)?.accountId : undefined;
    await undoLink(db, link);
    changed++;
    if (stale) continue;
    const view = (await getItem(row.id))!;
    try {
      if (madeByApp) {
        if (view.kind === 'share' && view.flow === 'to_me' && keepCategory) await makeShareEntry(db, view, link.personAccountId, view.personName, keepCategory);
      } else await linkInto(db, view, link.personAccountId, link.transactionId);
    } catch {
      // It no longer fits that entry: it waits for the user to link another.
    }
  }
  changed += await autoLink(db);
  if (changed > 0) notifyLedgerChange();
  return changed;
}

/**
 * A friend's loan or repayment, or the user's own, links itself when exactly
 * one entry fits and its payee is the person. One settled another way is
 * written on this side straight away.
 */
async function autoLink(db: Database): Promise<number> {
  let linked = 0;
  for (const view of await listItems()) {
    if (view.status !== 'needs_link' || view.kind === 'share' || !view.personId) continue;
    // Settled another way (decision 0027): this side writes it against its own settled account, no question asked.
    if (view.settledOutside) {
      try {
        await makeOutsideEntry(db, view, view.personId, view.personName);
        linked++;
      } catch {
        // Left for the next run.
      }
      continue;
    }
    const fits = await fitting(db, view);
    if (fits.length !== 1 || !fits[0]!.payeeIsPerson) continue;
    try {
      await linkInto(db, view, view.personId, fits[0]!.id);
      linked++;
    } catch {
      // Left for the user.
    }
  }
  return linked;
}

// ---- Balances and summaries ----

/** What the shared rows say a person owes, per currency, and how far this user's ledger is from it. */
export async function personTotals(personId: string): Promise<{ shared: Map<CurrencyCode, Paise>; gap: Map<CurrencyCode, Paise> }> {
  const items = await itemsWith(personId);
  const shared = sharedBalance(items);
  // Only what items put on the person's account is compared; entries made with them by hand before stay out.
  const fromItems = new Map<CurrencyCode, Paise>();
  for (const v of items) {
    if (!v.transactionId || !v.link?.linkedFlow || v.link.linkedPaise === null) continue;
    const c = v.link.linkedCurrency as CurrencyCode;
    fromItems.set(c, paise((fromItems.get(c) ?? 0) + (v.link.linkedFlow === 'to_them' ? v.link.linkedPaise : -v.link.linkedPaise)));
  }
  return { shared, gap: ledgerGap(shared, fromItems) };
}

export interface OwedSummary {
  owedToMe: Paise;
  iOwe: Paise;
  /** Items waiting for the user: a friend's share to answer, or one of theirs to link. */
  toAnswer: number;
}

/** HOME-1, from person balances in the home currency. */
export async function owedSummary(): Promise<OwedSummary> {
  const [people, items] = await Promise.all([listPeople(), listItems()]);
  let owedToMe = 0;
  let iOwe = 0;
  for (const p of people) {
    if (p.balance > 0) owedToMe += p.balance;
    else iOwe -= p.balance;
  }
  return { owedToMe: paise(owedToMe), iOwe: paise(iOwe), toAnswer: items.filter((v) => v.status === 'needs_answer').length };
}

// ---- Words ----

/** What an item is, in a few words from the user's side: "You paid, they owe their share", "You lent". */
export function itemTitle(view: Pick<ItemView, 'kind' | 'flow' | 'personName' | 'settledOutside'>): string {
  const name = view.personName;
  if (view.settledOutside) return view.flow === 'to_me' ? `${name} settled up with you` : `You settled up with ${name}`;
  if (view.kind === 'share') return view.flow === 'to_them' ? `${name}'s share of what you paid` : `Your share of what ${name} paid`;
  if (view.kind === 'loan') return view.flow === 'to_them' ? `You lent ${name}` : `${name} lent you`;
  return view.flow === 'to_them' ? `You paid ${name} back` : `${name} paid you back`;
}

export const STATUS_TEXT: Record<ItemStatus, string> = {
  linked: 'In your ledger',
  needs_link: 'Link your entry',
  needs_answer: 'Accept or decline',
  waiting: 'Waiting for them',
  declined: 'Declined',
};

/** A status line that fits the item: a share someone else paid needs no bank entry, so it never says "link". */
export function statusText(view: Pick<ItemView, 'status' | 'kind' | 'flow' | 'mine' | 'oneSided' | 'settledOutside'>): string {
  if (view.status === 'needs_link' && view.kind === 'share' && view.flow === 'to_them') return 'Link the entry you paid with';
  if (view.status === 'needs_link' && view.kind !== 'share') return view.flow === 'to_them' ? 'Link the payment you sent' : 'Link the payment you got';
  if (view.settledOutside) return 'Settled another way';
  if (view.status === 'linked' && view.oneSided) return 'Only on your phone';
  return STATUS_TEXT[view.status];
}

/** IOU-5: a message to send someone, with a UPI link to pay the user when they owe and the user has a UPI ID. */
export function reminderMessage(person: Person, me: Me): string {
  const owes = person.balances.filter((b) => b.amount > 0);
  const owe = person.balances.filter((b) => b.amount < 0);
  const lines: string[] = [];
  if (owes.length > 0) lines.push(`Hi ${person.account.name}, a gentle reminder about the ${owes.map((b) => formatAmount(b.amount, b.currency)).join(' and ')} from our splits and loans.`);
  if (owe.length > 0) lines.push(`${owes.length > 0 ? 'And' : `Hi ${person.account.name},`} I owe you ${owe.map((b) => formatAmount(-b.amount, b.currency)).join(' and ')}. I'll pay it soon.`);
  const inr = owes.find((b) => b.currency === 'INR');
  if (inr && me.vpa) lines.push(`You can pay me by UPI: ${buildUpiUri({ payeeVpa: me.vpa, payeeName: displayName(me), params: {} }, { amount: inr.amount, note: 'Money Plant' })}`);
  return lines.join('\n');
}

/** IOU-3: the link that opens a UPI app to pay what the user owes a person (rupees only, decision 0017). */
export function payLink(person: Person): string | null {
  const owe = person.balances.find((b) => b.currency === 'INR' && b.amount < 0);
  if (!owe || !person.account.vpa) return null;
  return buildUpiUri({ payeeVpa: person.account.vpa, payeeName: person.account.name, params: {} }, { amount: paise(-owe.amount), note: 'Money Plant' });
}

// ---- From an entry ----

/** The items an entry is the user's side of. */
export async function itemsOnEntry(transactionId: string): Promise<ItemView[]> {
  return (await listItems()).filter((v) => v.transactionId === transactionId);
}

/**
 * The category of an entry that carries items: every category leg (what is
 * left after the people's parts) moves to `categoryId`. The person legs and
 * the bank leg stay.
 */
export async function setEntryCategory(transactionId: string, categoryId: string): Promise<void> {
  const db = await getDb();
  const tx = await loadTx(db, transactionId);
  if (!tx) throw new Error('Entry not found');
  const owned = ownedAccountIds(db);
  const people = peopleIds(db);
  const isCategory = (p: LedgerPosting) => !owned.has(p.accountId) && !people.has(p.accountId);
  const merged = new Map<string, LedgerPosting>();
  const rest: LedgerPosting[] = [];
  for (const p of tx.postings) {
    if (!isCategory(p)) {
      rest.push(p);
      continue;
    }
    const key = p.currency ?? DEFAULT_CURRENCY;
    const into = merged.get(key);
    merged.set(key, into ? { ...into, amount: paise(into.amount + p.amount) } : { ...p, accountId: categoryId });
  }
  if (merged.size === 0) throw new Error('All of this entry is owed by people; it has no category of its own');
  writeTransaction(db, {
    ...tx,
    status: 'confirmed',
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: withField(tx.userSetFields, 'category'),
    postings: [...rest, ...[...merged.values()].filter((p) => p.amount !== 0)],
  });
  notifyLedgerChange();
}
