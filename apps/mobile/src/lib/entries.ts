import * as Crypto from 'expo-crypto';
import { eq } from 'drizzle-orm';
import { paise, type Paise } from '@money-plant/core';
import { normaliseMerchant, ruleFromEntry, ruleMatches, type RuleMatch } from '@money-plant/categoriser';
import { accounts, transactions } from '@money-plant/db-schema';
import { rebaseOpening, type LedgerTransaction, type UserSetField } from '@money-plant/matcher';
import { entryFeatures, ownedAccountIds, recategoriseHistory, toInput } from './categories';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { loadTransactions, SqliteLedgerStore, writeTransaction } from './ledger-store';
import { countRuleOutcome, createRule, learnPatterns, listRules, updateRule } from './rules-store';
import { supabase } from './supabase';

/** Review reasons that are about the category, so picking or accepting one settles them. */
const CATEGORY_REVIEWS = new Set(['person', 'pattern', 'category_unsure']);

async function load(id: string): Promise<LedgerTransaction> {
  const db = await getDb();
  const [tx] = loadTransactions(db, db.select().from(transactions).where(eq(transactions.id, id)).all());
  if (!tx) throw new Error('Entry not found');
  return tx;
}

const withField = (fields: readonly UserSetField[], ...add: UserSetField[]) => [...new Set([...fields, ...add])];

export interface CategoryChange {
  /** CAT-3: the rule to offer, "always do this for this merchant", or null when there is nothing to offer. */
  offer: RuleMatch | null;
  /** CAT-8: how many new patterns were proposed from this and earlier corrections. */
  proposed: number;
}

/**
 * The user picks a category for an entry (CAT-3, LED-8). The choice is marked
 * as user-set, so automation never changes it again, and the rule or pattern
 * that guessed counts a hit or a miss.
 */
export async function setEntryCategory(id: string, categoryId: string): Promise<CategoryChange> {
  const db = await getDb();
  const tx = await load(id);
  const owned = ownedAccountIds(db);
  const features = entryFeatures(tx, owned);
  if (!features) throw new Error("This entry can't take a category");
  const previous = tx.postings[features.categoryPostingIndex]!.accountId;
  if (tx.categoryRuleId && (tx.categoryReason === 'rule' || tx.categoryReason === 'pattern')) {
    await countRuleOutcome(tx.categoryRuleId, previous === categoryId ? 'hit' : 'miss');
  }
  const settles = tx.status === 'pending' && tx.reviewReason !== null && CATEGORY_REVIEWS.has(tx.reviewReason);
  writeTransaction(db, {
    ...tx,
    categoryReason: 'user',
    categoryRuleId: null,
    userSetFields: withField(tx.userSetFields, 'category'),
    postings: tx.postings.map((p, i) => (i === features.categoryPostingIndex ? { ...p, accountId: categoryId } : p)),
    ...(settles ? { status: 'confirmed' as const, reviewReason: null } : {}),
  });
  notifyLedgerChange();

  const proposed = await learnPatterns((entry) => {
    const f = entryFeatures(entry, owned);
    return f && { direction: f.direction, amount: f.amount, accountId: f.accountId, payeeKind: f.payeeKind };
  });
  const match = ruleFromEntry({ counterparty: tx.counterparty, vpa: features.vpa, direction: features.direction });
  const input = toInput({ ...features, counterparty: tx.counterparty, occurredAt: tx.occurredAt });
  const covered = (await listRules()).some(
    (rule) => rule.status === 'active' && rule.categoryId === categoryId && rule.match.kind === 'rule' && ruleMatches(rule.match, input),
  );
  return { offer: covered ? null : match, proposed };
}

/** CAT-3: turns a correction into a rule and applies it to earlier entries automation may still change. */
export async function addRule(match: RuleMatch, categoryId: string): Promise<number> {
  await createRule({ match, categoryId });
  return recategoriseHistory();
}

/** CAT-8: the user accepts a proposed pattern; it then categorises matching entries that have no category yet. */
export async function acceptPattern(ruleId: string, autoConfirm: boolean): Promise<number> {
  await updateRule(ruleId, { status: 'active', autoConfirm });
  return recategoriseHistory({ uncategorisedOnly: true });
}

export async function declinePattern(ruleId: string): Promise<void> {
  // Kept as declined, so the same idea is not proposed again.
  await updateRule(ruleId, { status: 'declined' });
}

/**
 * The user confirms an entry as it is. A pattern's guess counts as a hit; an
 * AI guess the AI was unsure about is shared, so the next person gets it from
 * the dictionary.
 */
export async function confirmEntry(id: string): Promise<void> {
  const db = await getDb();
  const tx = await load(id);
  if (tx.categoryRuleId && (tx.categoryReason === 'pattern' || tx.categoryReason === 'rule')) await countRuleOutcome(tx.categoryRuleId, 'hit');
  writeTransaction(db, { ...tx, status: 'confirmed', reviewReason: null });
  notifyLedgerChange();
  if (tx.categoryReason === 'ai' && tx.reviewReason === 'category_unsure' && tx.counterparty) {
    const features = entryFeatures(tx, ownedAccountIds(db));
    const categoryId = features ? tx.postings[features.categoryPostingIndex]!.accountId : null;
    const category = categoryId ? db.select().from(accounts).where(eq(accounts.id, categoryId)).get() : undefined;
    if (category?.categoryKey && !category.categoryKey.endsWith('custom')) {
      supabase.functions
        .invoke('categorise', { body: { confirm: [{ merchant: normaliseMerchant(tx.counterparty), key: category.categoryKey, name: tx.counterparty }] } })
        .catch(() => {});
    }
  }
}

export interface EntryEdit {
  counterparty?: string | null;
  note?: string | null;
  /** Positive; the direction stays as it was. */
  amount?: Paise;
  occurredAt?: string;
  accountId?: string;
}

/**
 * LED-8: the user edits an entry. Each changed field is marked user-set, so
 * re-parsing, dedupe, sync and AI leave it alone. The parsed values stay in
 * the entry's sources, so the original message is still visible.
 */
export async function editEntry(id: string, edit: EntryEdit): Promise<void> {
  const db = await getDb();
  const tx = await load(id);
  const owned = ownedAccountIds(db);
  const fields: UserSetField[] = [];
  const next: LedgerTransaction = { ...tx, postings: tx.postings.map((p) => ({ ...p })) };
  const touched = new Set<string>(tx.postings.filter((p) => owned.has(p.accountId)).map((p) => p.accountId));

  if (edit.counterparty !== undefined && edit.counterparty !== tx.counterparty) {
    next.counterparty = edit.counterparty?.trim() || null;
    fields.push('counterparty');
  }
  if (edit.note !== undefined && edit.note !== tx.note) {
    next.note = edit.note?.trim() || null;
    fields.push('note');
  }
  if (edit.occurredAt !== undefined && edit.occurredAt !== tx.occurredAt) {
    next.occurredAt = edit.occurredAt;
    fields.push('occurredAt');
  }
  if (edit.amount !== undefined || edit.accountId !== undefined) {
    if (next.postings.length !== 2) throw new Error("Split entries can't be edited this way yet");
    if (edit.amount !== undefined) {
      if (!Number.isSafeInteger(edit.amount) || edit.amount <= 0) throw new Error('Enter an amount above zero');
      const current = Math.abs(next.postings[0]!.amount);
      if (edit.amount !== current) {
        for (const p of next.postings) p.amount = paise(Math.sign(p.amount) * edit.amount);
        fields.push('amount');
      }
    }
    if (edit.accountId !== undefined) {
      if (!owned.has(edit.accountId)) throw new Error('Pick one of your accounts');
      const own = next.postings.find((p) => owned.has(p.accountId) && (tx.kind !== 'transfer' || p.amount < 0));
      if (own && own.accountId !== edit.accountId) {
        own.accountId = edit.accountId;
        touched.add(edit.accountId);
        fields.push('account');
      }
    }
  }
  if (fields.length === 0) return;
  next.userSetFields = withField(tx.userSetFields, ...fields);
  writeTransaction(db, next);
  const store = new SqliteLedgerStore(db);
  for (const accountId of touched) await rebaseOpening(store, accountId);
  notifyLedgerChange();
}

export interface ManualEntry {
  direction: 'debit' | 'credit';
  /** Positive. */
  amount: Paise;
  accountId: string;
  categoryId: string;
  counterparty?: string | null;
  note?: string | null;
  occurredAt?: string;
}

/**
 * CAP-7: a cash or other entry the user types in. The user picked every
 * field, so it is confirmed, marked user-set, and its source is a `manual`
 * row holding the same fields.
 */
export async function addManualEntry(entry: ManualEntry): Promise<string> {
  if (!Number.isSafeInteger(entry.amount) || entry.amount <= 0) throw new Error('Enter an amount above zero');
  const db = await getDb();
  if (!ownedAccountIds(db).has(entry.accountId)) throw new Error('Pick one of your accounts');
  const id = Crypto.randomUUID();
  const occurredAt = entry.occurredAt ?? new Date().toISOString();
  const signed = paise(entry.direction === 'debit' ? -entry.amount : entry.amount);
  const counterparty = entry.counterparty?.trim() || null;
  writeTransaction(db, {
    id,
    occurredAt,
    counterparty,
    kind: entry.direction === 'debit' ? 'expense' : 'income',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: 'user',
    categoryRuleId: null,
    userSetFields: ['category', 'amount', 'account', 'occurredAt', ...(counterparty ? (['counterparty'] as const) : [])],
    note: entry.note?.trim() || null,
    postings: [
      { id: Crypto.randomUUID(), accountId: entry.accountId, amount: signed },
      { id: Crypto.randomUUID(), accountId: entry.categoryId, amount: paise(-signed) },
    ],
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'manual',
        sender: null,
        externalRef: null,
        fingerprint: `manual:${id}`,
        parsedFields: { direction: entry.direction, amount: entry.amount, counterparty },
        receivedAt: new Date().toISOString(),
        confidence: 1,
        rawText: null,
      },
    ],
  });
  await rebaseOpening(new SqliteLedgerStore(db), entry.accountId);
  notifyLedgerChange();
  return id;
}
