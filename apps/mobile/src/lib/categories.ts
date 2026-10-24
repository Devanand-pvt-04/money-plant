import * as Crypto from 'expo-crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { paise, type Paise } from '@money-plant/core';
import {
  DEFAULT_CATEGORIES,
  categorise,
  flowOfKey,
  localTime,
  type CategoriseInput,
  type CategoryDecision,
  type CategoryFlow,
  type KnownMerchant,
  type PayeeKind,
  type Rule,
  type UserCategory,
} from '@money-plant/categoriser';
import { accounts, budgets, merchantCache, postings, rules, transactions } from '@money-plant/db-schema';
import {
  SYSTEM_ACCOUNT_NAMES,
  decisionReview,
  looksLikePerson,
  type CategoriseRequest,
  type LedgerTransaction,
  type SystemAccountKey,
} from '@money-plant/matcher';
import type { ParsedTransaction } from '@money-plant/parser';
import { getDb, type Database } from './db';
import { notifyLedgerChange } from './events';
import { currentUserId, derivedId } from './ids';
import { kvGet, kvSet } from './kv';
import { loadTransactions, systemAccountId, writeTransaction } from './ledger-store';
import { toRule } from './rules-store';

const now = () => new Date().toISOString();

export interface CategoryNode extends UserCategory {
  flow: CategoryFlow;
  /** The pipeline's Uncategorised accounts. They can't be renamed, moved or deleted. */
  system: boolean;
  children: CategoryNode[];
}

const SEEDED_KEY = 'categories.seeded';

/**
 * CAT-1: creates the default categories once per user. Ids are derived from
 * the user id and the key, so a second phone writes the same rows, and a
 * category the user deleted (a soft-deleted row) is not brought back. Users
 * from before the short list keep their tree: every default key was in the
 * old set, so its rows already exist and nothing new is added.
 */
export async function ensureDefaultCategories(): Promise<void> {
  const userId = await currentUserId();
  if ((await kvGet(SEEDED_KEY)) === userId) return;
  const db = await getDb();
  const createdAt = now();
  const ids = new Map<string, string>();
  for (const category of DEFAULT_CATEGORIES) ids.set(category.key, await derivedId(`category:${category.key}`));
  db.transaction((t) => {
    for (const category of DEFAULT_CATEGORIES) {
      t.insert(accounts)
        .values({
          id: ids.get(category.key)!,
          type: 'category',
          name: category.name,
          institution: null,
          last4: null,
          parentId: null,
          categoryKey: category.key,
          createdAt,
          dirty: 1,
        })
        .onConflictDoNothing()
        .run();
    }
  });
  await kvSet(SEEDED_KEY, userId);
}

async function systemIds(): Promise<Map<string, SystemAccountKey>> {
  const keys = Object.keys(SYSTEM_ACCOUNT_NAMES) as SystemAccountKey[];
  return new Map(await Promise.all(keys.map(async (key) => [await systemAccountId(key), key] as const)));
}

function categoryRows(db: Database) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.type, 'category'), isNull(accounts.deletedAt)))
    .all();
}

/** All live categories as a two-level tree, sorted by name, with the Uncategorised accounts last. */
export async function listCategories(): Promise<CategoryNode[]> {
  const db = await getDb();
  const system = await systemIds();
  const nodes = categoryRows(db)
    .filter((row) => system.get(row.id) !== 'adjustments')
    .map(
      (row): CategoryNode => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        key: row.categoryKey,
        flow: system.get(row.id) === 'uncategorised_income' ? 'income' : flowOfKey(row.categoryKey),
        system: system.has(row.id),
        children: [],
      }),
    );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: CategoryNode[] = [];
  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (a: CategoryNode, b: CategoryNode) => Number(a.system) - Number(b.system) || a.name.localeCompare(b.name);
  for (const node of roots) node.children.sort(order);
  return roots.sort(order);
}

export function flatten(tree: readonly CategoryNode[]): CategoryNode[] {
  return tree.flatMap((node) => [node, ...node.children]);
}

/** "Food > Lunch" for every category id, for labels. */
export async function categoryNames(): Promise<Map<string, string>> {
  const all = flatten(await listCategories());
  const byId = new Map(all.map((c) => [c.id, c]));
  return new Map(all.map((c) => [c.id, c.parentId && byId.get(c.parentId) ? `${byId.get(c.parentId)!.name} › ${c.name}` : c.name]));
}

/**
 * A new category's key: user-made categories map to "custom" under the
 * right root, so their flow is known but the dictionary never targets them.
 */
function customKey(parent: CategoryNode | undefined, flow: CategoryFlow): string {
  if (!parent) return flow === 'income' ? 'income.custom' : 'custom';
  const root = (parent.key ?? (parent.flow === 'income' ? 'income' : 'custom')).split('.')[0]!;
  return `${root}.custom`;
}

export async function createCategory(input: { name: string; parentId: string | null; flow: CategoryFlow }): Promise<string> {
  const db = await getDb();
  const all = flatten(await listCategories());
  const parent = input.parentId ? all.find((c) => c.id === input.parentId) : undefined;
  if (parent && (parent.parentId || parent.system)) throw new Error('Categories go two levels deep');
  const id = Crypto.randomUUID();
  db.insert(accounts)
    .values({
      id,
      type: 'category',
      name: input.name.trim(),
      institution: null,
      last4: null,
      parentId: parent?.id ?? null,
      categoryKey: customKey(parent, parent?.flow ?? input.flow),
      createdAt: now(),
      dirty: 1,
    })
    .run();
  notifyLedgerChange();
  return id;
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const db = await getDb();
  db.update(accounts)
    .set({ name: name.trim(), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id))
    .run();
  notifyLedgerChange();
}

/** CAT-5: moves a category under another top-level one, or to the top. Postings point at its id, so history moves with it. */
export async function moveCategory(id: string, parentId: string | null): Promise<void> {
  const all = flatten(await listCategories());
  const category = all.find((c) => c.id === id);
  const parent = parentId ? all.find((c) => c.id === parentId) : undefined;
  if (!category || category.system) throw new Error("This category can't be moved");
  if (parentId && (!parent || parent.parentId || parent.system || parent.id === id)) throw new Error('Pick a top-level category');
  if (parentId && category.children.length > 0) throw new Error('Move or merge its sub-categories first; categories go two levels deep');
  if (parent && parent.flow !== category.flow) throw new Error("Spending and income categories can't be mixed");
  const db = await getDb();
  db.update(accounts)
    .set({ parentId, dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, id))
    .run();
  notifyLedgerChange();
}

/**
 * CAT-5: moves every posting, rule and sub-category of `fromId` to `intoId`,
 * then deletes `fromId`. The entries keep their sources and history; only the
 * category they count toward changes.
 */
export async function mergeCategory(fromId: string, intoId: string): Promise<number> {
  const all = flatten(await listCategories());
  const from = all.find((c) => c.id === fromId);
  const into = all.find((c) => c.id === intoId);
  if (!from || !into || from.id === into.id || from.system) throw new Error("This category can't be merged");
  if (into.parentId === from.id) throw new Error("Can't merge a category into its own sub-category");
  if (from.flow !== into.flow) throw new Error("Spending and income categories can't be merged");
  if (from.children.length > 0 && into.parentId) throw new Error('Merge it into a top-level category, so its sub-categories have somewhere to go');

  const db = await getDb();
  const ids = db
    .selectDistinct({ id: postings.transactionId })
    .from(postings)
    .where(eq(postings.accountId, fromId))
    .all()
    .map((row) => row.id);
  const rows = ids.length ? db.select().from(transactions).where(inArray(transactions.id, ids)).all() : [];
  for (const tx of loadTransactions(db, rows)) {
    writeTransaction(db, { ...tx, postings: tx.postings.map((p) => (p.accountId === fromId ? { ...p, accountId: intoId } : p)) });
  }
  const changed = { dirty: 1, rev: sql`${rules.rev} + 1` };
  db.update(rules).set({ categoryAccountId: intoId, ...changed }).where(eq(rules.categoryAccountId, fromId)).run();
  db.update(budgets)
    .set({ deletedAt: now(), dirty: 1, rev: sql`${budgets.rev} + 1` })
    .where(eq(budgets.categoryAccountId, fromId))
    .run();
  db.update(accounts)
    .set({ parentId: intoId, dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(and(eq(accounts.parentId, fromId), isNull(accounts.deletedAt)))
    .run();
  db.update(accounts)
    .set({ deletedAt: now(), dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, fromId))
    .run();
  notifyLedgerChange();
  return rows.length;
}

/** Deleting a category merges it into its parent, or into Uncategorised for a top-level one. */
export async function deleteCategory(id: string): Promise<void> {
  const all = flatten(await listCategories());
  const category = all.find((c) => c.id === id);
  if (!category || category.system) throw new Error("This category can't be deleted");
  if (category.children.length > 0) throw new Error('Delete or move its sub-categories first');
  const fallback = category.parentId ?? (await systemAccountId(category.flow === 'income' ? 'uncategorised_income' : 'uncategorised_expense'));
  await mergeCategory(id, fallback);
}

// ---- Categorising entries ----

/** Merchant cache entries count as known for this long; unknown ones are asked about again after it. */
export const MERCHANT_RECHECK_DAYS = 30;

function merchantLookup(db: Database): (merchant: string) => KnownMerchant | null {
  const rows = db.select().from(merchantCache).all();
  const byName = new Map(rows.map((row) => [row.merchant, row]));
  return (merchant) => {
    const row = byName.get(merchant);
    return row?.categoryKey ? { key: row.categoryKey, confidence: row.confidence, source: row.source } : null;
  };
}

function activeRules(db: Database): Rule[] {
  return db
    .select()
    .from(rules)
    .where(and(isNull(rules.deletedAt), eq(rules.status, 'active')))
    .all()
    .map(toRule);
}

function categoriserContext(db: Database, tree: readonly CategoryNode[]) {
  return {
    rules: activeRules(db),
    // The Uncategorised accounts are never a decision.
    categories: flatten(tree).filter((c) => !c.system),
    knownMerchant: merchantLookup(db),
  };
}

const offset = (iso: string) => -new Date(iso).getTimezoneOffset();

export function toInput(request: CategoriseRequest): CategoriseInput {
  return { ...request, ...localTime(request.occurredAt, offset(request.occurredAt)) };
}

/** The capture pipeline's step 3 (CAT-2), on the phone's rules, patterns and merchant cache. */
export async function pipelineCategoriser(): Promise<(request: CategoriseRequest) => Promise<CategoryDecision | null>> {
  await ensureDefaultCategories();
  const db = await getDb();
  const ctx = categoriserContext(db, await listCategories());
  return async (request) => categorise(toInput(request), ctx);
}

/** The parts of an entry the categoriser and the learner need, read from its postings and sources. */
export interface EntryFeatures {
  direction: 'debit' | 'credit';
  amount: Paise;
  accountId: string;
  categoryPostingIndex: number;
  vpa: string | null;
  payeeKind: PayeeKind;
}

export function entryFeatures(tx: LedgerTransaction, ownedIds: ReadonlySet<string>): EntryFeatures | null {
  if ((tx.kind !== 'expense' && tx.kind !== 'income') || tx.postings.length !== 2) return null;
  const ownIndex = tx.postings.findIndex((p) => ownedIds.has(p.accountId));
  if (ownIndex === -1) return null;
  const own = tx.postings[ownIndex]!;
  const sms = tx.sources.find((s) => s.kind === 'sms')?.parsedFields as Partial<ParsedTransaction> | undefined;
  const vpa = sms?.vpa ?? null;
  const person = looksLikePerson({ channel: sms?.channel ?? 'upi', counterparty: tx.counterparty, vpa });
  return {
    direction: own.amount < 0 ? 'debit' : 'credit',
    amount: paise(Math.abs(own.amount)),
    accountId: own.accountId,
    categoryPostingIndex: ownIndex === 0 ? 1 : 0,
    vpa,
    payeeKind: person ? 'person' : 'business',
  };
}

export function ownedAccountIds(db: Database): Set<string> {
  return new Set(
    db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .all()
      .filter((a) => a.type !== 'category' && a.type !== 'person')
      .map((a) => a.id),
  );
}

/**
 * Runs the categoriser again over entries automation may still change: not
 * set by the user and not decided by a rule. Used after a new rule, an
 * accepted pattern or new AI answers. `only` limits it to some entries.
 */
export async function recategoriseHistory(options: { only?: (tx: LedgerTransaction) => boolean; uncategorisedOnly?: boolean } = {}): Promise<number> {
  await ensureDefaultCategories();
  const db = await getDb();
  const tree = await listCategories();
  const ctx = categoriserContext(db, tree);
  const owned = ownedAccountIds(db);
  const system = await systemIds();
  const conditions = [isNull(transactions.deletedAt), inArray(transactions.kind, ['expense', 'income'])];
  if (options.uncategorisedOnly) conditions.push(isNull(transactions.categoryReason));
  const rows = db.select().from(transactions).where(and(...conditions)).all();
  let changed = 0;
  for (const tx of loadTransactions(db, rows)) {
    if (tx.userSetFields.includes('category') || tx.categoryReason === 'user') continue;
    if (options.only && !options.only(tx)) continue;
    const features = entryFeatures(tx, owned);
    if (!features) continue;
    const decision = categorise(
      toInput({ ...features, counterparty: tx.counterparty, occurredAt: tx.occurredAt }),
      ctx,
    );
    if (!decision) continue;
    const leg = tx.postings[features.categoryPostingIndex]!;
    // A rule keeps an entry; only a different answer or a stronger layer moves it.
    if (leg.accountId === decision.categoryId && tx.categoryReason === decision.reason) continue;
    if (tx.categoryReason === 'rule' && decision.reason !== 'rule') continue;
    const next: LedgerTransaction = {
      ...tx,
      categoryReason: decision.reason,
      categoryRuleId: decision.ruleId,
      postings: tx.postings.map((p, i) => (i === features.categoryPostingIndex ? { ...p, accountId: decision.categoryId } : p)),
    };
    const wasUncategorised = system.has(leg.accountId);
    // Entries the user already confirmed stay confirmed; new suggestions on open or uncategorised entries wait in review.
    if (tx.reviewReason === null && tx.status === 'confirmed' && wasUncategorised) {
      next.reviewReason = decisionReview(decision);
      next.status = next.reviewReason ? 'pending' : 'confirmed';
    } else if (tx.reviewReason === 'person' || tx.reviewReason === 'category_unsure' || tx.reviewReason === 'pattern') {
      next.reviewReason = decisionReview(decision);
      next.status = next.reviewReason ? 'pending' : 'confirmed';
    }
    writeTransaction(db, next);
    changed++;
  }
  if (changed > 0) notifyLedgerChange();
  return changed;
}
