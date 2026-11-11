import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { accounts, ious, personContacts, postings, splitGroups, transactions } from '@money-plant/db-schema';
import { mergeDirection, payeeKey } from '@money-plant/matcher';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { pushSoon, refreshIous } from './ious';
import { loadTransactions, writeTransaction } from './ledger-store';
import { getMe } from './me';
import { payeeAliases, saveAliases, shareIousOf } from './people';

const now = () => new Date().toISOString();

/**
 * Decision 0020: `removeId` and `keepId` are one person, added twice (a phone
 * contact, then the friend who joined). Everything moves to `keepId` and
 * `removeId` is removed:
 * - every entry's leg on them, so balances stay sums of postings;
 * - IOUs this user added with them; open ones are shared with the kept
 *   person's email, settled ones stay as they are;
 * - IOUs shared with this user that were linked to them (the answer is sent
 *   again with the new link);
 * - split groups, the phone contact, payee names, and a UPI ID the kept
 *   person lacks.
 * Two people with different emails are two members, so they can't merge.
 */
export async function mergePeople(removeId: string, keepId: string): Promise<void> {
  if (removeId === keepId) throw new Error('Pick two different people');
  const db = await getDb();
  const me = await getMe();
  const remove = db.select().from(accounts).where(eq(accounts.id, removeId)).get();
  const keep = db.select().from(accounts).where(eq(accounts.id, keepId)).get();
  if (!remove || !keep || remove.type !== 'person' || keep.type !== 'person' || remove.deletedAt || keep.deletedAt) {
    throw new Error('Person not found');
  }
  if (!mergeDirection(remove, keep)) {
    throw new Error(`${remove.name} and ${keep.name} have different emails, so they are two people on Money Plant`);
  }
  if (remove.openingBalancePaise !== 0 && remove.currency !== keep.currency) {
    throw new Error(`${remove.name} has a starting balance in ${remove.currency}; settle it first`);
  }

  // Entries: move each leg, keeping the entry's own id and sources.
  const txIds = [
    ...new Set(
      db
        .select({ id: postings.transactionId })
        .from(postings)
        .innerJoin(transactions, eq(transactions.id, postings.transactionId))
        .where(and(eq(postings.accountId, removeId), isNull(transactions.deletedAt)))
        .all()
        .map((r) => r.id),
    ),
  ];
  if (txIds.length > 0) {
    const txs = loadTransactions(db, db.select().from(transactions).where(inArray(transactions.id, txIds)).all());
    for (const tx of txs) {
      writeTransaction(db, { ...tx, postings: tx.postings.map((p) => (p.accountId === removeId ? { ...p, accountId: keepId } : p)) });
    }
  }

  // IOUs this user added.
  db.update(ious)
    .set({ personAccountId: keepId, dirty: 1, rev: sql`${ious.rev} + 1` })
    .where(and(eq(ious.personAccountId, removeId), eq(ious.userId, me.id)))
    .run();
  if (keep.email) await shareIousOf(keepId, keep.email);

  // IOUs friends shared with this user, answered with the removed person.
  const answered = db
    .select()
    .from(ious)
    .where(and(eq(ious.counterpartyPersonAccountId, removeId), isNull(ious.deletedAt)))
    .all();
  for (const row of answered) {
    db.update(ious)
      .set({ counterpartyPersonAccountId: keepId, ...(row.confirmedAt && !row.declinedAt ? { response: 'accept' as const } : {}) })
      .where(eq(ious.id, row.id))
      .run();
  }

  // Groups.
  for (const group of db.select().from(splitGroups).where(isNull(splitGroups.deletedAt)).all()) {
    let members: string[];
    try {
      members = JSON.parse(group.memberAccountIds) as string[];
    } catch {
      continue;
    }
    if (!members.includes(removeId)) continue;
    const next = [...new Set(members.map((m) => (m === removeId ? keepId : m)))];
    db.update(splitGroups)
      .set({ memberAccountIds: JSON.stringify(next), dirty: 1, rev: sql`${splitGroups.rev} + 1` })
      .where(eq(splitGroups.id, group.id))
      .run();
  }

  // Phone contact (local only): the kept person keeps theirs, else takes this one.
  const removedContact = db.select().from(personContacts).where(eq(personContacts.personAccountId, removeId)).get();
  const keptContact = db.select().from(personContacts).where(eq(personContacts.personAccountId, keepId)).get();
  db.delete(personContacts).where(eq(personContacts.personAccountId, removeId)).run();
  if (removedContact && !keptContact) db.insert(personContacts).values({ personAccountId: keepId, contactId: removedContact.contactId }).run();

  // Payee names: everything that meant the removed person, and their name, now mean the kept one.
  const aliases = await payeeAliases();
  for (const [key, personId] of aliases) if (personId === removeId) aliases.set(key, keepId);
  const removedKey = payeeKey(remove.name);
  if (removedKey && removedKey !== payeeKey(keep.name)) aliases.set(removedKey, keepId);
  await saveAliases(aliases);

  // The kept person takes the UPI ID and starting balance; the removed one goes.
  db.update(accounts)
    .set({ deletedAt: now(), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, removeId))
    .run();
  db.update(accounts)
    .set({
      vpa: keep.vpa ?? remove.vpa,
      openingBalancePaise: keep.openingBalancePaise + remove.openingBalancePaise,
      dirty: 1,
      rev: sql`${accounts.rev} + 1`,
    })
    .where(eq(accounts.id, keepId))
    .run();

  notifyLedgerChange();
  await refreshIous();
  pushSoon();
}
