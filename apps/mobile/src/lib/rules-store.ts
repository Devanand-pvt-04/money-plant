import * as Crypto from 'expo-crypto';
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  localTime,
  proposePatterns,
  type Correction,
  type PatternMatch,
  type Rule,
  type RuleMatch,
  type RuleStatus,
} from '@money-plant/categoriser';
import { rules, transactions, type LocalRule } from '@money-plant/db-schema';
import type { LedgerTransaction } from '@money-plant/matcher';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { loadTransactions } from './ledger-store';

const now = () => new Date().toISOString();
const DAY = 24 * 60 * 60 * 1000;

/**
 * Decision 0037: how many entries each rule or pattern categorised that the
 * user kept, counted from the entries themselves. Entries still carrying the
 * rule's guess and confirmed (by the user in Review, or directly) are right;
 * a correction clears the link. Nothing is stored, so rules that confirm
 * directly count too, and so do entries from before this was counted.
 */
type Db = Awaited<ReturnType<typeof getDb>>;
function keptCounts(db: Db): Map<string, number> {
  const rows = db
    .select({ ruleId: transactions.categoryRuleId, kept: sql<number>`count(*)` })
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        isNotNull(transactions.categoryRuleId),
        inArray(transactions.categoryReason, ['rule', 'pattern']),
        eq(transactions.status, 'confirmed'),
      ),
    )
    .groupBy(transactions.categoryRuleId)
    .all();
  return new Map(rows.map((r) => [r.ruleId!, Number(r.kept)]));
}

export function toRule(row: LocalRule, kept?: ReadonlyMap<string, number>): Rule {
  return {
    id: row.id,
    match: JSON.parse(row.match) as RuleMatch | PatternMatch,
    categoryId: row.categoryAccountId,
    status: row.status,
    autoConfirm: row.autoConfirm === 1,
    hits: kept?.get(row.id) ?? 0,
    misses: row.misses,
    note: row.note,
  };
}

/** CAT-7: every rule and pattern, including proposals. Declined patterns are kept only so they aren't proposed again. */
export async function listRules(): Promise<Rule[]> {
  const db = await getDb();
  const kept = keptCounts(db);
  return db
    .select()
    .from(rules)
    .where(isNull(rules.deletedAt))
    .all()
    .map((row) => toRule(row, kept))
    .filter((rule) => rule.status !== 'declined');
}

export async function getRule(id: string): Promise<Rule | null> {
  const db = await getDb();
  const row = db.select().from(rules).where(eq(rules.id, id)).get();
  return row && !row.deletedAt ? toRule(row, keptCounts(db)) : null;
}

export async function createRule(input: { match: RuleMatch | PatternMatch; categoryId: string; status?: RuleStatus; autoConfirm?: boolean }): Promise<string> {
  const db = await getDb();
  const id = Crypto.randomUUID();
  db.insert(rules)
    .values({
      id,
      kind: input.match.kind,
      status: input.status ?? 'active',
      match: JSON.stringify(input.match),
      categoryAccountId: input.categoryId,
      // Rules confirm directly; patterns start as suggestions (CAT-8).
      autoConfirm: (input.autoConfirm ?? input.match.kind === 'rule') ? 1 : 0,
      createdAt: now(),
      dirty: 1,
    })
    .run();
  notifyLedgerChange();
  return id;
}

export async function updateRule(
  id: string,
  changes: Partial<{ match: RuleMatch | PatternMatch; categoryId: string; status: RuleStatus; autoConfirm: boolean; note: string | null }>,
): Promise<void> {
  const db = await getDb();
  db.update(rules)
    .set({
      ...(changes.match ? { match: JSON.stringify(changes.match) } : {}),
      ...(changes.categoryId ? { categoryAccountId: changes.categoryId } : {}),
      ...(changes.status ? { status: changes.status } : {}),
      ...(changes.autoConfirm !== undefined ? { autoConfirm: changes.autoConfirm ? 1 : 0 } : {}),
      ...(changes.note !== undefined ? { note: changes.note?.trim().slice(0, 200) || null } : {}),
      dirty: 1,
      rev: sql`${rules.rev} + 1`,
    })
    .where(eq(rules.id, id))
    .run();
  notifyLedgerChange();
}

export async function deleteRule(id: string): Promise<void> {
  const db = await getDb();
  db.update(rules)
    .set({ deletedAt: now(), dirty: 1, rev: sql`${rules.rev} + 1` })
    .where(eq(rules.id, id))
    .run();
  notifyLedgerChange();
}

/**
 * Counts a correction for the rule or pattern that categorised an entry. Right
 * answers aren't stored: they are counted from the entries (decision 0037).
 */
export async function countCorrection(ruleId: string): Promise<void> {
  const db = await getDb();
  db.update(rules)
    .set({ misses: sql`${rules.misses} + 1`, dirty: 1, rev: sql`${rules.rev} + 1` })
    .where(eq(rules.id, ruleId))
    .run();
}

/**
 * CAT-8: looks at the last 30 days of entries the user categorised by hand and
 * stores any new pattern as a proposal for the review inbox. Runs on the
 * phone; nothing here goes to the AI.
 */
export async function learnPatterns(
  features: (tx: LedgerTransaction) => Pick<Correction, 'direction' | 'amount' | 'accountId' | 'payeeKind'> | null,
): Promise<number> {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.categoryReason, 'user'), gte(transactions.occurredAt, since)))
    .all();
  const corrections: Correction[] = [];
  for (const tx of loadTransactions(db, rows)) {
    const f = features(tx);
    if (!f) continue;
    const categoryId = tx.postings.find((p) => p.accountId !== f.accountId)?.accountId;
    if (!categoryId) continue;
    const local = localTime(tx.occurredAt, -new Date(tx.occurredAt).getTimezoneOffset());
    corrections.push({ ...f, ...local, transactionId: tx.id, categoryId, occurredAt: tx.occurredAt });
  }
  const existing = db.select().from(rules).where(isNull(rules.deletedAt)).all().map((row) => toRule(row));
  const proposals = proposePatterns(corrections, existing, new Date());
  for (const proposal of proposals) {
    await createRule({ match: proposal.match, categoryId: proposal.categoryId, status: 'proposed', autoConfirm: false });
  }
  return proposals.length;
}
