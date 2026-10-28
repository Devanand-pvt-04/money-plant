import * as Crypto from 'expo-crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { dateOf, paise, type DateKey, type Paise } from '@money-plant/core';
import { accounts, iouPayments, ious, splitGroups, transactions } from '@money-plant/db-schema';
import { paidByOtherPostings, splitPostings, type LedgerTransaction } from '@money-plant/matcher';
import { formatAmount } from '@/components/format';
import { ownedAccountIds } from './categories';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { addManualEntry } from './entries';
import { deleteIou, insertIou, listIous, pushSoon, refreshIous } from './ious';
import { listPeople, type Person } from './people';
import { loadTransactions, systemAccountId, writeTransaction } from './ledger-store';

const now = () => new Date().toISOString();

async function loadTx(id: string): Promise<LedgerTransaction> {
  const db = await getDb();
  const [tx] = loadTransactions(db, db.select().from(transactions).where(and(eq(transactions.id, id), isNull(transactions.deletedAt))).all());
  if (!tx) throw new Error('Entry not found');
  return tx;
}

async function personIds(): Promise<Set<string>> {
  const db = await getDb();
  return new Set(db.select({ id: accounts.id }).from(accounts).where(eq(accounts.type, 'person')).all().map((a) => a.id));
}

/** IOUs this user made from an entry: the people in a split, or who paid for them. */
async function iousOf(transactionId: string) {
  const db = await getDb();
  return db
    .select()
    .from(ious)
    .where(and(eq(ious.transactionId, transactionId), isNull(ious.deletedAt)))
    .all();
}

export interface EntrySplit {
  /** The money out this split divides. */
  total: Paise;
  categoryId: string | null;
  myShare: Paise;
  /** Person account id to share. */
  shares: Map<string, Paise>;
}

/** How an entry is split now, or null for a plain payment. */
export async function currentSplit(transactionId: string): Promise<EntrySplit | null> {
  const db = await getDb();
  const tx = await loadTx(transactionId);
  const people = await personIds();
  const owned = ownedAccountIds(db);
  const personLegs = tx.postings.filter((p) => people.has(p.accountId) && p.amount > 0);
  if (tx.kind !== 'expense' || personLegs.length === 0 || (await iousOf(transactionId)).length === 0) return null;
  const own = tx.postings.find((p) => owned.has(p.accountId));
  const category = tx.postings.find((p) => !owned.has(p.accountId) && !people.has(p.accountId));
  return {
    total: paise(Math.abs(own?.amount ?? 0)),
    categoryId: category?.accountId ?? null,
    myShare: paise(category?.amount ?? 0),
    shares: new Map(personLegs.map((p) => [p.accountId, p.amount])),
  };
}

/**
 * The money out a split can divide: an expense one of the user's accounts
 * paid. A loan (kind iou, including a split the user had no share of) is
 * undone by deleting its IOUs instead.
 */
export async function splittable(transactionId: string): Promise<{ total: Paise; categoryId: string | null } | null> {
  const db = await getDb();
  const tx = await loadTx(transactionId).catch(() => null);
  if (!tx || tx.kind !== 'expense') return null;
  const owned = ownedAccountIds(db);
  const own = tx.postings.filter((p) => owned.has(p.accountId));
  if (own.length !== 1 || own[0]!.amount >= 0) return null;
  const people = await personIds();
  const category = tx.postings.find((p) => !owned.has(p.accountId) && !people.has(p.accountId));
  return { total: paise(-own[0]!.amount), categoryId: category?.accountId ?? null };
}

function checkShares(total: Paise, myShare: Paise, shares: ReadonlyMap<string, Paise>): void {
  const sum = paise([...shares.values()].reduce<number>((s, v) => s + v, myShare));
  if (sum !== total) throw new Error(`The shares add up to ${formatAmount(sum)}, not ${formatAmount(total)}`);
  if (shares.size === 0 || [...shares.values()].every((v) => v === 0)) throw new Error('Add at least one person with a share');
}

/**
 * SPL-1: splits a payment the user made. Each person's share moves from the
 * category to that person (they owe it), and becomes a lent IOU linked to the
 * entry. The entry keeps its sources. A split entry is split again by undoing
 * the old split first.
 */
export async function splitEntry(
  transactionId: string,
  input: { categoryId: string; myShare: Paise; shares: ReadonlyMap<string, Paise>; dueDate: DateKey | null; groupId?: string | null },
): Promise<void> {
  const can = await splittable(transactionId);
  if (!can) throw new Error('Only money you paid out can be split');
  checkShares(can.total, input.myShare, input.shares);
  if (await currentSplit(transactionId)) await unsplit(transactionId);
  const db = await getDb();
  const tx = await loadTx(transactionId);
  const owned = ownedAccountIds(db);
  const own = tx.postings.find((p) => owned.has(p.accountId))!;
  const postings = splitPostings(own, input.categoryId, input.myShare, input.shares, () => Crypto.randomUUID());
  writeTransaction(db, {
    ...tx,
    kind: input.myShare > 0 ? 'expense' : 'iou',
    status: 'confirmed',
    reviewReason: null,
    categoryReason: 'user',
    categoryRuleId: null,
    userSetFields: [...new Set([...tx.userSetFields, 'category' as const, 'kind' as const])],
    postings,
    ...(input.groupId !== undefined ? { splitGroupId: input.groupId } : {}),
  });
  const reason = tx.counterparty ?? tx.note;
  for (const [personId, share] of input.shares) {
    if (share <= 0) continue;
    await insertIou({
      personId,
      direction: 'lent',
      amount: share,
      reason: reason ? `Split: ${reason}`.slice(0, 200) : 'Split',
      occurredOn: dateOf(tx.occurredAt),
      dueDate: input.dueDate,
      transactionId,
    });
  }
  notifyLedgerChange();
  await refreshIous();
  pushSoon();
}

/** Undoes a split: the people's shares go back to the category. Not once someone has paid part of it back. */
export async function unsplit(transactionId: string): Promise<void> {
  const db = await getDb();
  const rows = await iousOf(transactionId);
  if (rows.length === 0) return;
  const paid = db
    .select({ id: iouPayments.id })
    .from(iouPayments)
    .where(and(inArray(iouPayments.iouId, rows.map((r) => r.id)), isNull(iouPayments.deletedAt)))
    .all();
  if (paid.length > 0) throw new Error('Someone has already paid back part of this split, so it stays split');
  for (const row of rows) await deleteIou(row.id);
}

/**
 * SPL-2: someone else paid, and the user owes their share. The entry has no
 * account of the user's: the share is spent in the category and owed to the
 * person. A borrowed IOU links to it, so paying it back settles it (IOU-4).
 */
export async function paidBySomeoneElse(input: {
  payerId: string;
  categoryId: string;
  myShare: Paise;
  /** The whole bill, kept in the note so the user remembers. */
  total: Paise | null;
  what: string | null;
  occurredOn: DateKey;
  dueDate: DateKey | null;
  groupId?: string | null;
}): Promise<string> {
  if (!Number.isSafeInteger(input.myShare) || input.myShare <= 0) throw new Error('Enter your share');
  if (input.total !== null && input.total < input.myShare) throw new Error('Your share is more than the bill');
  const db = await getDb();
  const payer = db.select().from(accounts).where(eq(accounts.id, input.payerId)).get();
  if (!payer || payer.type !== 'person') throw new Error('Pick who paid');
  const id = Crypto.randomUUID();
  const what = input.what?.trim() || null;
  const note = input.total !== null && input.total !== input.myShare ? `My share of ${formatAmount(input.total)}` : null;
  writeTransaction(db, {
    id,
    occurredAt: new Date(`${input.occurredOn}T12:00:00`).toISOString(),
    counterparty: what ?? payer.name,
    kind: 'expense',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: 'user',
    categoryRuleId: null,
    userSetFields: ['category', 'amount', 'account', 'occurredAt', 'kind'],
    note,
    splitGroupId: input.groupId ?? null,
    postings: paidByOtherPostings(input.payerId, input.categoryId, input.myShare, () => Crypto.randomUUID()),
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'manual',
        sender: null,
        externalRef: null,
        fingerprint: `manual:${id}`,
        parsedFields: { direction: 'debit', amount: input.myShare, counterparty: payer.name, ...(input.total !== null ? { total: input.total } : {}) },
        receivedAt: now(),
        confidence: 1,
        rawText: null,
      },
    ],
  });
  await insertIou({
    personId: input.payerId,
    direction: 'borrowed',
    amount: input.myShare,
    reason: what ? `Share of ${what}`.slice(0, 200) : 'My share',
    occurredOn: input.occurredOn,
    dueDate: input.dueDate,
    transactionId: id,
  });
  notifyLedgerChange();
  await refreshIous();
  pushSoon();
  return id;
}

/**
 * SPL-1: one "expense with people" for every case. The user paid (a new
 * entry from one of their accounts, or an existing one being split), and the
 * others owe their shares; or someone else paid, and the user owes theirs.
 * In a group, the entry is tagged with it (SPL-3).
 */
export async function addExpense(input: {
  total: Paise;
  what: string | null;
  /** 'me', or the person account that paid. */
  paidBy: string;
  /** The user's account, for a new entry the user paid. */
  accountId: string | null;
  /** An existing entry to split instead of a new one. */
  fromEntry: string | null;
  groupId: string | null;
  categoryId: string;
  myShare: Paise;
  /** Everyone else's share, by person account. */
  shares: ReadonlyMap<string, Paise>;
  occurredAt: string;
}): Promise<string> {
  if (!Number.isSafeInteger(input.total) || input.total <= 0) throw new Error('Enter the amount');
  if (input.paidBy !== 'me') {
    if (input.myShare <= 0) throw new Error("You aren't in this expense, so there's nothing for you to owe");
    return paidBySomeoneElse({
      payerId: input.paidBy,
      categoryId: input.categoryId,
      myShare: input.myShare,
      total: input.total,
      what: input.what,
      occurredOn: dateOf(input.occurredAt),
      dueDate: null,
      groupId: input.groupId,
    });
  }
  checkShares(input.total, input.myShare, input.shares);
  let id = input.fromEntry;
  if (!id) {
    if (!input.accountId) throw new Error('Pick the account you paid from');
    // With no share of their own (a loan), the category leg is replaced by the people's shares straight away.
    const categoryId = input.categoryId || (await systemAccountId('uncategorised_expense'));
    id = await addManualEntry({ direction: 'debit', amount: input.total, accountId: input.accountId, categoryId, counterparty: input.what, occurredAt: input.occurredAt });
  }
  await splitEntry(id, { categoryId: input.categoryId, myShare: input.myShare, shares: input.shares, dueDate: null, groupId: input.groupId });
  return id;
}

// ---- Groups (SPL-3) ----

export interface SplitGroup {
  id: string;
  name: string;
  memberIds: string[];
}

export async function listGroups(): Promise<SplitGroup[]> {
  const db = await getDb();
  const people = await personIds();
  return db
    .select()
    .from(splitGroups)
    .where(isNull(splitGroups.deletedAt))
    .all()
    .map((g) => ({ id: g.id, name: g.name, memberIds: (JSON.parse(g.memberAccountIds) as string[]).filter((m) => people.has(m)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveGroup(input: { id?: string; name: string; memberIds: readonly string[] }): Promise<string> {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error('Name the group');
  if (input.memberIds.length === 0) throw new Error('Add at least one person');
  if (input.memberIds.length > 50) throw new Error('A group can have up to 50 people');
  const db = await getDb();
  const memberAccountIds = JSON.stringify([...new Set(input.memberIds)]);
  if (input.id) {
    db.update(splitGroups)
      .set({ name, memberAccountIds, dirty: 1, rev: sql`${splitGroups.rev} + 1` })
      .where(eq(splitGroups.id, input.id))
      .run();
    notifyLedgerChange();
    return input.id;
  }
  const id = Crypto.randomUUID();
  db.insert(splitGroups).values({ id, name, memberAccountIds, createdAt: now(), dirty: 1 }).run();
  notifyLedgerChange();
  return id;
}

export async function deleteGroup(id: string): Promise<void> {
  const db = await getDb();
  db.update(splitGroups)
    .set({ deletedAt: now(), dirty: 1, rev: sql`${splitGroups.rev} + 1` })
    .where(eq(splitGroups.id, id))
    .run();
  notifyLedgerChange();
}

export interface GroupExpense {
  id: string;
  occurredAt: string;
  title: string;
  /** Null when the user paid. */
  payerName: string | null;
  /** The whole bill, when known. */
  total: Paise;
  /** How many people share it, the user included. */
  ways: number;
  /** Above zero they owe the user for it, below zero the user owes. */
  net: Paise;
}

export interface GroupOverview {
  group: SplitGroup;
  expenses: GroupExpense[];
  /** Each member's open balance from this group's expenses: above zero they owe the user. */
  members: { person: Person; balance: Paise }[];
  spent: Paise;
  net: Paise;
}

/**
 * SPL-3: a group's expenses and where each member stands within it. A
 * member's balance is what is still open on the IOUs of the group's
 * expenses, so paying one back (IOU-4) settles it here too.
 */
/** What a group's overview reads besides its own entries; the People tab loads it once for every group. */
export interface GroupContext {
  groups: Awaited<ReturnType<typeof listGroups>>;
  people: Awaited<ReturnType<typeof listPeople>>;
  ious: Awaited<ReturnType<typeof listIous>>;
}

export async function groupOverview(groupId: string, context?: GroupContext): Promise<GroupOverview | null> {
  const group = (context?.groups ?? (await listGroups())).find((g) => g.id === groupId);
  if (!group) return null;
  const db = await getDb();
  const rows = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.splitGroupId, groupId), isNull(transactions.deletedAt)))
    .all();
  const txs = loadTransactions(db, rows).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const owned = ownedAccountIds(db);
  const people = context?.people ?? (await listPeople());
  const byId = new Map(people.map((p) => [p.account.id, p]));
  const expenses = txs.map((tx): GroupExpense => {
    const own = tx.postings.find((p) => owned.has(p.accountId));
    const personLegs = tx.postings.filter((p) => byId.has(p.accountId));
    const payer = own ? null : personLegs.find((p) => p.amount < 0);
    const manual = tx.sources.find((src) => src.kind === 'manual')?.parsedFields as { total?: unknown } | undefined;
    const total = own ? -own.amount : typeof manual?.total === 'number' ? manual.total : -(payer?.amount ?? 0);
    const mine = tx.postings.some((p) => !owned.has(p.accountId) && !byId.has(p.accountId) && p.amount > 0);
    return {
      id: tx.id,
      occurredAt: tx.occurredAt,
      title: tx.counterparty ?? tx.note ?? 'Expense',
      payerName: payer ? (byId.get(payer.accountId)?.account.name ?? 'Someone') : null,
      total: paise(total),
      ways: (own ? personLegs.filter((p) => p.amount > 0).length : 1) + (mine && own ? 1 : 0),
      net: paise(personLegs.reduce((sum, p) => sum + p.amount, 0)),
    };
  });
  const ids = new Set(txs.map((tx) => tx.id));
  const open = new Map<string, number>();
  for (const iou of context?.ious ?? (await listIous())) {
    if (!iou.personId || !iou.transactionId || !ids.has(iou.transactionId) || iou.state === 'declined') continue;
    open.set(iou.personId, (open.get(iou.personId) ?? 0) + (iou.direction === 'lent' ? iou.outstanding : -iou.outstanding));
  }
  const members = group.memberIds
    .map((id) => byId.get(id))
    .filter((p): p is Person => p !== undefined)
    .map((person) => ({ person, balance: paise(open.get(person.account.id) ?? 0) }))
    .sort((a, b) => b.balance - a.balance);
  return {
    group,
    expenses,
    members,
    spent: paise(expenses.reduce((sum, e) => sum + e.total, 0)),
    net: paise(members.reduce((sum, m) => sum + m.balance, 0)),
  };
}
