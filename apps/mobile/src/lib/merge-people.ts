import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { accounts, itemLinks, personContacts, postings, transactions } from '@money-plant/db-schema';
import { mergeDirection, payeeKey } from '@money-plant/matcher';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { loadTransactions, writeTransaction } from './ledger-store';
import { moveIdentifiers } from './identity';
import { payeeAliases, saveAliases, shareItemsOf } from './people';
import { pushSoon } from './shared';

const now = () => new Date().toISOString();

/**
 * Decision 0020: `removeId` and `keepId` are one person, added twice (a phone
 * contact, then the friend who joined). Everything moves to `keepId` and
 * `removeId` is removed:
 * - every entry's leg on them, so balances stay sums of postings;
 * - this user's links from shared items to them, and the items this user
 *   made with them, which are shared with the kept person's email
 *   (decision 0026);
 * - the phone contact, payee names, and every identifier
 *   (UPI IDs, phone, bank accounts, payee names: decision 0025).
 * Two people with different emails are two members, so they can't merge.
 */
export async function mergePeople(removeId: string, keepId: string): Promise<void> {
  if (removeId === keepId) throw new Error('Pick two different people');
  const db = await getDb();
  const remove = db.select().from(accounts).where(eq(accounts.id, removeId)).get();
  const keep = db.select().from(accounts).where(eq(accounts.id, keepId)).get();
  if (!remove || !keep || remove.type !== 'person' || keep.type !== 'person' || remove.deletedAt || keep.deletedAt) {
    throw new Error('Person not found');
  }
  const facts = (a: typeof keep) => ({ id: a.id, name: a.name, vpa: a.vpa, email: a.email });
  if (!mergeDirection(facts(remove), facts(keep))) {
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

  // Shared items (decision 0026): this user's links to them, then their items go to the kept person's email.
  db.update(itemLinks)
    .set({ personAccountId: keepId, dirty: 1, rev: sql`${itemLinks.rev} + 1` })
    .where(eq(itemLinks.personAccountId, removeId))
    .run();
  await shareItemsOf(keepId, keep.email);

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

  // The kept person takes every identifier (decision 0025) and the starting balance; the removed one goes.
  await moveIdentifiers(removeId, keepId);
  const vpa = keep.vpa ?? remove.vpa;
  db.update(accounts)
    .set({ deletedAt: now(), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, removeId))
    .run();
  db.update(accounts)
    .set({
      vpa,
      openingBalancePaise: keep.openingBalancePaise + remove.openingBalancePaise,
      dirty: 1,
      rev: sql`${accounts.rev} + 1`,
    })
    .where(eq(accounts.id, keepId))
    .run();

  notifyLedgerChange();
  pushSoon();
}
