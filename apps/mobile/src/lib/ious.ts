import * as Crypto from 'expo-crypto';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { addDays, buildUpiUri, dateKey, daysBetween, dateOf, DEFAULT_CURRENCY, paise, startOfDate, type DateKey, type Paise } from '@money-plant/core';
import { accounts, iouPayments, ious, postings, sources, transactions } from '@money-plant/db-schema';
import {
  allocateRepayment,
  canRepay,
  findPerson,
  guessRepayment,
  iouView,
  isOpenIou,
  isVisibleIou,
  repaymentDirection,
  repaymentOptionsFor,
  type IouView,
  type RepaymentOption,
  matchRepayment,
  rebaseOpening,
  type IouDirection,
  type LedgerTransaction,
  type UserSetField,
} from '@money-plant/matcher';
import type { ParsedTransaction } from '@money-plant/parser';
import { formatAmount, formatDate } from '@/components/format';
import { ownedAccountIds } from './categories';
import { getDb } from './db';
import { homeCurrency } from './home-currency';
import { notifyLedgerChange } from './events';
import { loadTransactions, SqliteLedgerStore, systemAccountId, writeTransaction } from './ledger-store';
import { displayName, getMe, type Me } from './me';
import { cancelScheduled, notifyAt } from './notifications';
import { createPerson, listPeople, payeeAliases, rememberPayee } from './people';
import { syncNow } from './sync';

const now = () => new Date().toISOString();
/** Shared IOUs should reach the other person quickly, so changes go up without waiting for the next sync. */
export const pushSoon = () => void syncNow().catch(() => {});
const REMINDER_PREFIX = 'iou:';
/** How far back a payment can be a repayment of an open IOU. */
const SETTLE_LOOKBACK_DAYS = 90;

export type { IouState, IouView, RepaymentOption } from '@money-plant/matcher';

/** Every IOU this user can see, with what is still owed. Ones they declined are left out. */
export async function listIous(): Promise<IouView[]> {
  const db = await getDb();
  const [me, people] = await Promise.all([getMe(), listPeople()]);
  const rows = db.select().from(ious).where(isNull(ious.deletedAt)).all();
  if (rows.length === 0) return [];
  const paymentRows = db
    .select()
    .from(iouPayments)
    .where(and(isNull(iouPayments.deletedAt), inArray(iouPayments.iouId, rows.map((r) => r.id))))
    .all();
  const byPerson = new Map(people.map((p) => [p.account.id, { name: p.account.name, vpa: p.account.vpa }]));
  return rows
    .map((row) =>
      iouView(
        row,
        me.id,
        (id) => byPerson.get(id),
        paymentRows
          .filter((p) => p.iouId === row.id)
          .map((p) => ({ id: p.id, iouId: p.iouId, byMe: p.userId === me.id, amount: paise(p.amountPaise), paidAt: p.paidAt })),
      ),
    )
    .filter(isVisibleIou);
}

export async function getIou(id: string): Promise<IouView | null> {
  return (await listIous()).find((v) => v.id === id) ?? null;
}

/** Open IOUs that count toward balances: not declined, not waiting for this user's answer. */
export const isOpen = isOpenIou;

// ---- Ledger entries for loans and repayments ----

/** How an IOU reaches the ledger: an entry that is already there (the bank SMS), or a new one on an account. */
export type EntryLink = { existingId: string } | { accountId: string };

async function loadTx(id: string): Promise<LedgerTransaction> {
  const db = await getDb();
  const [tx] = loadTransactions(db, db.select().from(transactions).where(and(eq(transactions.id, id), isNull(transactions.deletedAt))).all());
  if (!tx) throw new Error('Entry not found');
  return tx;
}

const withFields = (fields: readonly UserSetField[], ...add: UserSetField[]) => [...new Set([...fields, ...add])];

/**
 * Turns a plain payment into a loan or repayment: its category leg moves to
 * the person, so the money shows as owed instead of spent or earned. The
 * sources stay, so dedupe and reconciliation are unaffected.
 */
export async function convertEntry(id: string, personId: string, expected?: { direction: IouDirection; amount: Paise; repayment: boolean }): Promise<LedgerTransaction> {
  const db = await getDb();
  const tx = await loadTx(id);
  const owned = ownedAccountIds(db);
  if (tx.postings.length !== 2) throw new Error('Only a plain payment can become an IOU; this entry is split');
  const own = tx.postings.find((p) => owned.has(p.accountId));
  const other = tx.postings.find((p) => !owned.has(p.accountId));
  if (!own || !other) throw new Error("This entry doesn't move money in one of your accounts");
  if (expected) {
    // Lending and paying back a loan are money out; borrowing and being paid back are money in.
    const out = expected.repayment ? expected.direction === 'borrowed' : expected.direction === 'lent';
    if ((own.amount < 0) !== out) throw new Error(out ? 'This entry is money in, not money out' : 'This entry is money out, not money in');
    if (Math.abs(own.amount) !== expected.amount) throw new Error(`This entry is ${formatAmount(Math.abs(own.amount))}, not ${formatAmount(expected.amount)}`);
  }
  const next: LedgerTransaction = {
    ...tx,
    kind: 'iou',
    status: 'confirmed',
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: withFields(tx.userSetFields, 'category', 'kind'),
    postings: tx.postings.map((p) => (p === other ? { ...p, accountId: personId } : p)),
  };
  writeTransaction(db, next);
  return next;
}

/** A new loan or repayment entry the user records by hand, with a `manual` source. */
async function manualEntry(input: { personId: string; accountId: string; ownAmount: Paise; counterparty: string; note: string | null; occurredAt: string }): Promise<string> {
  const db = await getDb();
  if (!ownedAccountIds(db).has(input.accountId)) throw new Error('Pick one of your accounts');
  // In the account's currency (decision 0017); the person's account takes any.
  const currency = db.select({ currency: accounts.currency }).from(accounts).where(eq(accounts.id, input.accountId)).get()?.currency ?? DEFAULT_CURRENCY;
  const id = Crypto.randomUUID();
  writeTransaction(db, {
    id,
    occurredAt: input.occurredAt,
    counterparty: input.counterparty,
    kind: 'iou',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: ['category', 'amount', 'account', 'occurredAt', 'kind'],
    note: input.note,
    postings: [
      { id: Crypto.randomUUID(), accountId: input.accountId, amount: input.ownAmount, currency },
      { id: Crypto.randomUUID(), accountId: input.personId, amount: paise(-input.ownAmount), currency },
    ],
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'manual',
        sender: null,
        externalRef: null,
        fingerprint: `manual:${id}`,
        parsedFields: { direction: input.ownAmount < 0 ? 'debit' : 'credit', amount: Math.abs(input.ownAmount), counterparty: input.counterparty },
        receivedAt: now(),
        confidence: 1,
        rawText: null,
      },
    ],
  });
  await rebaseOpening(new SqliteLedgerStore(db), input.accountId);
  return id;
}

async function entryFor(
  link: EntryLink | null,
  input: { personId: string; personName: string; direction: IouDirection; amount: Paise; reason: string | null; occurredOn: DateKey; occurredAt?: string },
): Promise<string | null> {
  if (!link) return null;
  if ('existingId' in link) {
    const tx = await convertEntry(link.existingId, input.personId, { direction: input.direction, amount: input.amount, repayment: false });
    // Money from them is from their own account, so their bank name is them. Money out on a loan is
    // often paid to a shop for them (medicines bought for a friend), so that payee isn't learned.
    if (input.direction === 'borrowed') await rememberPayee(input.personId, payeeOf(tx));
    return link.existingId;
  }
  return manualEntry({
    personId: input.personId,
    accountId: link.accountId,
    ownAmount: paise(input.direction === 'lent' ? -input.amount : input.amount),
    counterparty: input.personName,
    note: input.reason,
    // The time the user picked. A friend's IOU has only a date: noon keeps it on that date in any time zone.
    occurredAt: input.occurredAt ?? new Date(`${input.occurredOn}T12:00:00`).toISOString(),
  });
}

// ---- Creating and changing IOUs ----

export interface NewIou {
  personId: string;
  direction: IouDirection;
  amount: Paise;
  reason: string | null;
  occurredOn: DateKey;
  /** When the money moved, for the ledger entry made by hand. The IOU itself keeps only the date. */
  occurredAt?: string;
  dueDate: DateKey | null;
}

/** Inserts the IOU row only. Its ledger entry is made by the caller. */
export async function insertIou(input: NewIou & { transactionId: string | null }): Promise<string> {
  const db = await getDb();
  const me = await getMe();
  const person = (await listPeople()).find((p) => p.account.id === input.personId);
  if (!person) throw new Error('Person not found');
  const id = Crypto.randomUUID();
  // The IOU is in its entry's currency, else the home currency (decision 0017).
  const entryCurrency = input.transactionId
    ? db.select({ currency: postings.currency }).from(postings).where(eq(postings.transactionId, input.transactionId)).get()?.currency
    : undefined;
  db.insert(ious)
    .values({
      id,
      userId: me.id,
      ownerName: displayName(me),
      ownerEmail: me.email,
      ownerVpa: me.vpa,
      personAccountId: input.personId,
      direction: input.direction,
      amountPaise: input.amount,
      currency: entryCurrency ?? homeCurrency(),
      reason: input.reason?.trim() || null,
      occurredOn: input.occurredOn,
      dueDate: input.dueDate,
      transactionId: input.transactionId,
      counterpartyEmail: person.account.email,
      createdAt: now(),
      dirty: 1,
    })
    .run();
  return id;
}

/** IOU-1: records money lent or borrowed, with its ledger entry. */
export async function createIou(input: NewIou, link: EntryLink): Promise<string> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter an amount above zero');
  if (input.dueDate && input.dueDate < input.occurredOn) throw new Error('The due date is before the loan');
  const person = (await listPeople()).find((p) => p.account.id === input.personId);
  if (!person) throw new Error('Person not found');
  const transactionId = await entryFor(link, { ...input, personName: person.account.name });
  const id = await insertIou({ ...input, transactionId });
  await refreshIous();
  pushSoon();
  return id;
}

/** The owner edits an IOU. A changed amount, direction or due date asks the other person to confirm again (server side). */
export async function updateIou(id: string, changes: { reason?: string | null; dueDate?: DateKey | null }): Promise<void> {
  const db = await getDb();
  const row = db.select().from(ious).where(eq(ious.id, id)).get();
  const me = await getMe();
  if (!row || row.userId !== me.id) throw new Error('Only the person who added this IOU can change it');
  db.update(ious)
    .set({
      ...(changes.reason !== undefined ? { reason: changes.reason?.trim() || null } : {}),
      ...(changes.dueDate !== undefined ? { dueDate: changes.dueDate, confirmedAt: row.counterpartyEmail ? null : row.confirmedAt } : {}),
      dirty: 1,
      rev: sql`${ious.rev} + 1`,
    })
    .where(eq(ious.id, id))
    .run();
  await refreshIous();
  pushSoon();
}

/**
 * The owner removes an IOU added by mistake. A loan entry typed by hand goes
 * with it; one from a bank SMS goes back to review as a payment to a person.
 */
export async function deleteIou(id: string): Promise<void> {
  const db = await getDb();
  const me = await getMe();
  const row = db.select().from(ious).where(eq(ious.id, id)).get();
  if (!row || row.userId !== me.id) throw new Error('Only the person who added this IOU can delete it');
  const stamp = now();
  db.update(ious).set({ deletedAt: stamp, dirty: 1, rev: sql`${ious.rev} + 1` }).where(eq(ious.id, id)).run();
  if (row.transactionId) await releaseEntry(row.transactionId, row.personAccountId);
  notifyLedgerChange();
  await refreshIous();
  pushSoon();
}

/**
 * Undoes what an IOU did to its entry. A loan entry made or converted for it:
 * a manual one is removed, an SMS one goes back to the review inbox
 * uncategorised. A split or someone else's payment: the person's share goes
 * back to the category, and an entry left with nothing in it is removed.
 */
async function releaseEntry(transactionId: string, personId: string): Promise<void> {
  const db = await getDb();
  const tx = await loadTx(transactionId).catch(() => null);
  if (!tx) return;
  const store = new SqliteLedgerStore(db);
  const ownedIds = ownedAccountIds(db);
  const owned = tx.postings.filter((p) => ownedIds.has(p.accountId)).map((p) => p.accountId);
  const remove = () =>
    db.update(transactions).set({ deletedAt: now(), dirty: 1, rev: sql`${transactions.rev} + 1` }).where(eq(transactions.id, tx.id)).run();
  if (tx.kind !== 'iou' || tx.postings.length > 2) {
    const leg = tx.postings.find((p) => p.accountId === personId);
    if (!leg) return;
    const people = new Set(db.select({ id: accounts.id }).from(accounts).where(eq(accounts.type, 'person')).all().map((a) => a.id));
    const rest = tx.postings.filter((p) => p !== leg).map((p) => ({ ...p }));
    const category = rest.find((p) => !ownedIds.has(p.accountId) && !people.has(p.accountId));
    if (category) category.amount = paise(category.amount + leg.amount);
    else rest.push({ ...leg, accountId: await systemAccountId(leg.amount > 0 ? 'uncategorised_expense' : 'uncategorised_income') });
    const postingsLeft = rest.filter((p) => p.amount !== 0);
    if (postingsLeft.length < 2) remove();
    else {
      const hasCategory = postingsLeft.some((p) => !ownedIds.has(p.accountId) && !people.has(p.accountId));
      writeTransaction(db, { ...tx, kind: hasCategory ? 'expense' : 'iou', postings: postingsLeft });
    }
  } else if (tx.sources.every((s) => s.kind === 'manual')) {
    remove();
  } else {
    const own = tx.postings.find((p) => p.accountId !== personId);
    const out = (own?.amount ?? 0) < 0;
    const fallback = await systemAccountId(out ? 'uncategorised_expense' : 'uncategorised_income');
    writeTransaction(db, {
      ...tx,
      kind: out ? 'expense' : 'income',
      status: 'pending',
      reviewReason: 'person',
      userSetFields: tx.userSetFields.filter((f) => f !== 'category' && f !== 'kind'),
      postings: tx.postings.map((p) => (p.accountId === personId ? { ...p, accountId: fallback } : p)),
    });
  }
  for (const accountId of owned) await rebaseOpening(store, accountId);
}

/**
 * IOU-4, by hand: the user records a repayment the app didn't see (cash, or
 * an account without SMS). Creates the entry and the payment record.
 */
export async function recordRepayment(id: string, input: { amount: Paise; accountId: string; paidAt: string }): Promise<void> {
  const view = await getIou(id);
  if (!view || !view.personId) throw new Error('IOU not found');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter an amount above zero');
  if (input.amount > view.outstanding) throw new Error(`Only ${formatAmount(view.outstanding, view.currency)} is still owed`);
  const paidAt = input.paidAt;
  const transactionId = await manualEntry({
    personId: view.personId,
    accountId: input.accountId,
    // Being paid back is money in; paying back is money out.
    ownAmount: paise(view.direction === 'lent' ? input.amount : -input.amount),
    counterparty: view.otherName,
    note: view.reason ? `Repayment: ${view.reason}` : 'Repayment',
    occurredAt: paidAt,
  });
  await addPayments([{ iouId: id, amount: input.amount }], transactionId, paidAt);
  notifyLedgerChange();
  await refreshIous();
  pushSoon();
}

async function addPayments(parts: readonly { iouId: string; amount: Paise }[], transactionId: string, paidAt: string): Promise<void> {
  const db = await getDb();
  const me = await getMe();
  for (const part of parts) {
    db.insert(iouPayments)
      .values({ id: Crypto.randomUUID(), userId: me.id, iouId: part.iouId, amountPaise: part.amount, paidAt, transactionId, createdAt: now(), dirty: 1 })
      .run();
  }
}

// ---- Shared IOUs: the other person's answer (IOU-2) ----

/**
 * The other person confirms or declines an IOU shared with them. Confirming
 * adds the owner as a person in their ledger and records the loan from their
 * side: linked to the entry that is already there, or a new one, or none yet.
 * The answer reaches the server on the next sync, through respond_iou.
 */
export async function respondToIou(id: string, accept: boolean, link: EntryLink | null): Promise<void> {
  const db = await getDb();
  const me = await getMe();
  const row = db.select().from(ious).where(eq(ious.id, id)).get();
  if (!row || row.userId === me.id) throw new Error('This IOU was not shared with you');
  if (!accept) {
    db.update(ious).set({ response: 'decline', declinedAt: now(), confirmedAt: null }).where(eq(ious.id, id)).run();
    notifyLedgerChange();
    pushSoon();
    return;
  }
  const people = await listPeople();
  const existing =
    (row.counterpartyPersonAccountId ? people.find((p) => p.account.id === row.counterpartyPersonAccountId) : undefined) ??
    people.find((p) => row.ownerEmail !== null && p.account.email === row.ownerEmail) ??
    people.find((p) => row.ownerVpa !== null && p.account.vpa === row.ownerVpa);
  const ownerName = row.ownerName ?? row.ownerEmail?.split('@')[0] ?? 'Friend';
  const personId =
    existing?.account.id ?? (await createPerson({ name: ownerName, vpa: row.ownerVpa, email: row.ownerEmail }));
  const direction: IouDirection = row.direction === 'lent' ? 'borrowed' : 'lent';
  const transactionId =
    row.counterpartyTransactionId ??
    (await entryFor(link, { personId, personName: ownerName, direction, amount: paise(row.amountPaise), reason: row.reason, occurredOn: row.occurredOn }));
  db.update(ious)
    .set({
      response: 'accept',
      counterpartyUserId: me.id,
      counterpartyPersonAccountId: personId,
      counterpartyTransactionId: transactionId,
      counterpartyVpa: me.vpa,
      confirmedAt: row.confirmedAt ?? now(),
      declinedAt: null,
    })
    .where(eq(ious.id, id))
    .run();
  notifyLedgerChange();
  await refreshIous();
  pushSoon();
}

// ---- Settling from the ledger (IOU-4) ----

/**
 * Entries that may be a repayment: a plain payment to or from someone that
 * no category was decided for, or that waits in review as a payment to a person.
 */
async function repaymentCandidates(): Promise<LedgerTransaction[]> {
  const db = await getDb();
  const from = new Date(Date.now() - SETTLE_LOOKBACK_DAYS * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), inArray(transactions.kind, ['expense', 'income']), gte(transactions.occurredAt, from)))
    .all();
  const fallbacks = new Set([await systemAccountId('uncategorised_expense'), await systemAccountId('uncategorised_income')]);
  return loadTransactions(db, rows).filter(
    (tx) =>
      tx.postings.length === 2 &&
      !tx.userSetFields.includes('category') &&
      (tx.reviewReason === 'person' || tx.postings.some((p) => fallbacks.has(p.accountId))),
  );
}

/**
 * IOU-4: a payment from someone who owes the user (or to someone the user
 * owes), for no more than is open, becomes a repayment: the entry moves to
 * the person and the IOUs it pays are marked, oldest due first. Returns how
 * many entries it settled.
 */
async function settleFromLedger(views: readonly IouView[]): Promise<number> {
  const open = views.filter(isOpen);
  if (open.length === 0) return 0;
  const db = await getDb();
  const people = (await listPeople()).map((p) => ({ id: p.account.id, name: p.account.name, vpa: p.account.vpa }));
  const aliases = await payeeAliases();
  const owned = ownedAccountIds(db);
  let settled = 0;
  const remaining = new Map(open.map((v) => [v.id, v.outstanding]));
  for (const tx of await repaymentCandidates()) {
    const own = tx.postings.find((p) => owned.has(p.accountId));
    if (!own) continue;
    const sms = tx.sources.find((s) => s.kind === 'sms')?.parsedFields as Partial<ParsedTransaction> | undefined;
    const on = dateOf(tx.occurredAt);
    const live = open
      .filter((v) => canRepay(v, on, tx.id))
      .map((v) => ({ ...v, outstanding: paise(remaining.get(v.id) ?? 0) }));
    const match = matchRepayment(
      { direction: own.amount < 0 ? 'debit' : 'credit', amount: paise(Math.abs(own.amount)), vpa: sms?.vpa ?? null, name: tx.counterparty },
      people,
      live,
      aliases,
    );
    if (!match) continue;
    await convertEntry(tx.id, match.personId);
    await addPayments(match.parts, tx.id, tx.occurredAt);
    for (const part of match.parts) remaining.set(part.iouId, paise((remaining.get(part.iouId) ?? 0) - part.amount));
    settled++;
  }
  if (settled > 0) notifyLedgerChange();
  return settled;
}

/** The payee of an entry as the bank wrote it: name and UPI ID. */
function payeeOf(tx: LedgerTransaction): { name: string | null; vpa: string | null } {
  const vpa = tx.sources.find((s) => s.kind === 'sms')?.parsedFields.vpa;
  return { name: tx.counterparty, vpa: typeof vpa === 'string' ? vpa : null };
}

/**
 * IOU-4 by hand: the people an entry could be a repayment from (money in) or
 * to (money out). Each has open IOUs in that direction from on or before the
 * entry's day, with at least the entry's amount still owed. Likely ones first.
 */
export async function repaymentOptions(transactionId: string): Promise<{ amount: Paise; direction: IouDirection; options: RepaymentOption[] }> {
  const db = await getDb();
  const tx = await loadTx(transactionId);
  const owned = ownedAccountIds(db);
  const own = tx.postings.find((p) => owned.has(p.accountId));
  if (!own || tx.postings.length !== 2) return { amount: paise(0), direction: 'lent', options: [] };
  const direction = repaymentDirection(own.amount);
  const amount = paise(Math.abs(own.amount));
  const people = (await listPeople()).map((p) => ({ id: p.account.id, name: p.account.name, vpa: p.account.vpa }));
  const match = findPerson(people, payeeOf(tx), await payeeAliases())?.id ?? null;
  const options = repaymentOptionsFor(await listIous(), { transactionId: tx.id, on: dateOf(tx.occurredAt), amount, direction }, match);
  return { amount, direction, options };
}

/**
 * IOU-4 by hand: the user says this bank entry is a repayment from or to the
 * person. The entry moves to the person (no new entry), their open IOUs are
 * paid oldest due first, and the payee's name and UPI ID are remembered for
 * them, so their next repayment settles on its own.
 */
export async function settleWithEntry(transactionId: string, personId: string): Promise<void> {
  const { amount, direction, options } = await repaymentOptions(transactionId);
  const option = options.find((o) => o.personId === personId);
  if (!option) throw new Error(direction === 'lent' ? "They don't owe you this much from before this day" : "You don't owe them this much from before this day");
  const tx = await loadTx(transactionId);
  const on = dateOf(tx.occurredAt);
  const open = (await listIous()).filter((v) => isOpen(v) && v.personId === personId && v.direction === direction && canRepay(v, on, tx.id));
  const { parts } = allocateRepayment(open, amount);
  await convertEntry(transactionId, personId, { direction, amount, repayment: true });
  await addPayments(parts, transactionId, tx.occurredAt);
  await rememberPayee(personId, payeeOf(tx));
  notifyLedgerChange();
  await refreshIous();
  pushSoon();
}

export interface RepaymentGuess {
  personId: string;
  name: string;
}

/**
 * For Review: entries that are probably a repayment the app couldn't match by
 * name, because exactly one person has an open IOU of exactly that amount.
 */
export async function repaymentGuesses(txs: readonly LedgerTransaction[]): Promise<Map<string, RepaymentGuess>> {
  const guesses = new Map<string, RepaymentGuess>();
  const open = (await listIous()).filter(isOpen);
  if (open.length === 0) return guesses;
  const db = await getDb();
  const owned = ownedAccountIds(db);
  for (const tx of txs) {
    if (tx.postings.length !== 2 || (tx.kind !== 'income' && tx.kind !== 'expense')) continue;
    const own = tx.postings.find((p) => owned.has(p.accountId));
    if (!own) continue;
    const guess = guessRepayment(open, { transactionId: tx.id, on: dateOf(tx.occurredAt), ownAmount: own.amount });
    if (guess) guesses.set(tx.id, guess);
  }
  return guesses;
}

let refreshing: Promise<number> | null = null;

/** Settles IOUs from new payments, then reschedules due-date reminders. Concurrent calls share one run. */
export function refreshIous(): Promise<number> {
  refreshing ??= (async () => {
    try {
      const settled = await settleFromLedger(await listIous());
      await scheduleIouReminders(await listIous());
      return settled;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---- Reminders and messages (IOU-5) ----

const REMINDER_HOUR = 9;

async function scheduleIouReminders(views: readonly IouView[]): Promise<void> {
  await cancelScheduled(REMINDER_PREFIX);
  const today = dateKey(new Date());
  for (const view of views) {
    if (!isOpen(view) || !view.dueDate || view.state === 'awaiting_them') continue;
    for (const before of [1, 0]) {
      const day = addDays(view.dueDate, -before);
      if (daysBetween(today, day) < 0) continue;
      const at = startOfDate(day);
      at.setHours(REMINDER_HOUR);
      const when = before === 1 ? 'tomorrow' : 'today';
      const amount = formatAmount(view.outstanding, view.currency);
      await notifyAt({
        id: `${REMINDER_PREFIX}${view.id}:${before}`,
        channel: 'reminders',
        at,
        title: view.direction === 'lent' ? `${view.otherName} owes you ${amount}` : `You owe ${view.otherName} ${amount}`,
        body: `Due ${when}${view.reason ? ` · ${view.reason}` : ''}. ${view.direction === 'lent' ? 'Tap to send a reminder.' : 'Tap to pay with UPI.'}`,
        data: { url: `/iou/${view.id}` },
      });
    }
  }
}

/**
 * IOU-5: a message the user can send to someone not on the app (or anyone),
 * with a UPI link to pay the user back when the user has set their UPI ID.
 */
export function reminderMessage(view: IouView, me: Me): string {
  const amount = formatAmount(view.outstanding, view.currency);
  const due = view.dueDate ? `, due ${formatDate(`${view.dueDate}T12:00:00`)}` : '';
  const what = view.reason ? ` for ${view.reason}` : '';
  const lines =
    view.direction === 'lent'
      ? [`Hi ${view.otherName}, a gentle reminder about the ${amount}${what}${due}.`]
      : [`Hi ${view.otherName}, I owe you ${amount}${what}${due}. I'll pay it soon.`];
  if (view.direction === 'lent' && me.vpa) {
    lines.push(`You can pay me by UPI: ${buildUpiUri({ payeeVpa: me.vpa, payeeName: displayName(me), params: {} }, { amount: view.outstanding, note: view.reason ?? 'Money Plant IOU' })}`);
  }
  if (view.role === 'owner' && view.sharedWith && view.state === 'awaiting_them') {
    lines.push(`I've put this in Money Plant. Sign in with ${view.sharedWith} to see and confirm it.`);
  }
  return lines.join('\n');
}

/** IOU-3: the link that opens a UPI app to pay what this user owes. */
export function payLink(view: IouView, amount: Paise = view.outstanding): string | null {
  // UPI is rupees only (decision 0017).
  if (view.direction !== 'borrowed' || !view.otherVpa || view.currency !== 'INR') return null;
  return buildUpiUri(
    { payeeVpa: view.otherVpa, payeeName: view.otherName, params: {} },
    { amount, note: view.reason ? `Repay: ${view.reason}`.slice(0, 50) : 'IOU repayment' },
  );
}

// ---- Summaries (HOME-1, NW-1) ----

export interface OwedSummary {
  /** What others owe the user, from person balances. */
  owedToMe: Paise;
  /** What the user owes others. */
  iOwe: Paise;
  /** IOUs shared with the user that wait for a yes or no. */
  toConfirm: number;
}

export async function owedSummary(): Promise<OwedSummary> {
  const [people, views] = await Promise.all([listPeople(), listIous()]);
  let owedToMe = 0;
  let iOwe = 0;
  for (const p of people) {
    if (p.balance > 0) owedToMe += p.balance;
    else iOwe -= p.balance;
  }
  return { owedToMe: paise(owedToMe), iOwe: paise(iOwe), toConfirm: views.filter((v) => v.state === 'awaiting_me').length };
}

/** Entries that may be the loan itself, for linking: same amount and direction, within 3 days, not yet an IOU. */
export async function loanCandidates(direction: IouDirection, amount: Paise, on: DateKey): Promise<LedgerTransaction[]> {
  const db = await getDb();
  const from = new Date(startOfDate(addDays(on, -3))).toISOString();
  const to = new Date(startOfDate(addDays(on, 4))).toISOString();
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), inArray(transactions.kind, ['expense', 'income']), gte(transactions.occurredAt, from)))
    .all()
    .filter((r) => r.occurredAt < to);
  const owned = ownedAccountIds(db);
  const linked = new Set(
    db
      .select({ id: ious.transactionId })
      .from(ious)
      .where(isNull(ious.deletedAt))
      .all()
      .map((r) => r.id),
  );
  return loadTransactions(db, rows).filter((tx) => {
    if (tx.postings.length !== 2 || linked.has(tx.id)) return false;
    const own = tx.postings.find((p) => owned.has(p.accountId));
    return own !== undefined && Math.abs(own.amount) === amount && (own.amount < 0) === (direction === 'lent');
  });
}

/** Whether an entry came only from the user typing it in. */
export async function isManualOnly(transactionId: string): Promise<boolean> {
  const db = await getDb();
  const kinds = db.select({ kind: sources.kind }).from(sources).where(eq(sources.transactionId, transactionId)).all();
  return kinds.length > 0 && kinds.every((s) => s.kind === 'manual');
}
