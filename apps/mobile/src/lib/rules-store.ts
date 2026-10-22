import * as Crypto from 'expo-crypto';
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
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

export function toRule(row: LocalRule): Rule {
  return {
    id: row.id,
    match: JSON.parse(row.match) as RuleMatch | PatternMatch,
    categoryId: row.categoryAccountId,
    status: row.status,
    autoConfirm: row.autoConfirm === 1,
    hits: row.hits,
    misses: row.misses,
  };
}

/** CAT-7: every rule and pattern, including proposals. Declined patterns are kept only so they aren't proposed again. */
export async function listRules(): Promise<Rule[]> {
  const db = await getDb();
  return db
    .select()
    .from(rules)
    .where(isNull(rules.deletedAt))
    .all()
    .map(toRule)
    .filter((rule) => rule.status !== 'declined');
}

export async function getRule(id: string): Promise<Rule | null> {
  const db = await getDb();
  const row = db.select().from(rules).where(eq(rules.id, id)).get();
  return row && !row.deletedAt ? toRule(row) : null;
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
  changes: Partial<{ match: RuleMatch | PatternMatch; categoryId: string; status: RuleStatus; autoConfirm: boolean }>,
): Promise<void> {
  const db = await getDb();
  db.update(rules)
    .set({
      ...(changes.match ? { match: JSON.stringify(changes.match) } : {}),
      ...(changes.categoryId ? { categoryAccountId: changes.categoryId } : {}),
      ...(changes.status ? { status: changes.status } : {}),
      ...(changes.autoConfirm !== undefined ? { autoConfirm: changes.autoConfirm ? 1 : 0 } : {}),
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

/** Counts a confirmation (hit) or a correction (miss) for the rule or pattern that categorised an entry. */
export async function countRuleOutcome(ruleId: string, outcome: 'hit' | 'miss'): Promise<void> {
  const db = await getDb();
  const count = outcome === 'hit' ? { hits: sql`${rules.hits} + 1` } : { misses: sql`${rules.misses} + 1` };
  db.update(rules)
    .set({ ...count, dirty: 1, rev: sql`${rules.rev} + 1` })
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
  const existing = db.select().from(rules).where(isNull(rules.deletedAt)).all().map(toRule);
  const proposals = proposePatterns(corrections, existing, new Date());
  for (const proposal of proposals) {
    await createRule({ match: proposal.match, categoryId: proposal.categoryId, status: 'proposed', autoConfirm: false });
  }
  return proposals.length;
}
