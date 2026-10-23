import { categoryForKey, flowOfKey, type UserCategory } from './categories';
import { lookupBuiltin, normaliseMerchant } from './dictionary';
import {
  patternMatches,
  ruleMatches,
  ruleSpecificity,
  type CategoriseInput,
  type CategoryReason,
  type PatternMatch,
  type Rule,
  type RuleMatch,
} from './rules';

/** A merchant learned from the shared dictionary or the AI, cached on the phone. */
export interface KnownMerchant {
  key: string;
  confidence: number;
  source: 'dictionary' | 'ai';
}

export interface CategoriserContext {
  rules: readonly Rule[];
  categories: readonly UserCategory[];
  /** Looks up a normalised merchant name in the phone's merchant cache. */
  knownMerchant?: (merchant: string) => KnownMerchant | null;
}

export interface CategoryDecision {
  categoryId: string;
  reason: CategoryReason;
  ruleId: string | null;
  confidence: number;
  /** False means the entry waits in review as a suggestion. */
  autoConfirm: boolean;
}

export const RULE_CONFIDENCE = 0.95;
/** Pattern matches start as suggestions (architecture: learned patterns). */
export const PATTERN_CONFIDENCE = 0.7;
export const DICTIONARY_CONFIDENCE = 0.9;
/** AI answers below this go to review instead of being applied silently. */
export const AI_CONFIDENT = 0.8;

/**
 * CAT-2: user rules, then learned patterns, then the merchant dictionary.
 * Returns null when none of them knows the entry; the caller then applies the
 * payments-to-people check (CAT-4) and, for businesses, asks the AI.
 */
export function categorise(input: CategoriseInput, ctx: CategoriserContext): CategoryDecision | null {
  const active = ctx.rules.filter((rule) => rule.status === 'active' && ctx.categories.some((c) => c.id === rule.categoryId));

  const rules = active
    .filter((rule): rule is Rule & { match: RuleMatch } => rule.match.kind === 'rule')
    .sort((a, b) => ruleSpecificity(b.match) - ruleSpecificity(a.match));
  const rule = rules.find((r) => ruleMatches(r.match, input));
  if (rule) {
    return { categoryId: rule.categoryId, reason: 'rule', ruleId: rule.id, confidence: RULE_CONFIDENCE, autoConfirm: rule.autoConfirm };
  }

  const patterns = active
    .filter((r): r is Rule & { match: PatternMatch } => r.match.kind === 'pattern')
    // The narrower amount band is the better guess when two patterns overlap.
    .sort((a, b) => a.match.maxAmount - a.match.minAmount - (b.match.maxAmount - b.match.minAmount));
  const pattern = patterns.find((p) => patternMatches(p.match, input));
  if (pattern) {
    return {
      categoryId: pattern.categoryId,
      reason: 'pattern',
      ruleId: pattern.id,
      confidence: PATTERN_CONFIDENCE,
      autoConfirm: pattern.autoConfirm,
    };
  }

  // People's names say nothing about what the money was for.
  if (input.payeeKind === 'person') return null;
  const known = dictionaryKey(input, ctx);
  if (!known) return null;
  // A salary key on money going out is a misread; refunds from shops (credit to a spending key) are fine.
  if (flowOfKey(known.key) === 'income' && input.direction === 'debit') return null;
  const category = categoryForKey(ctx.categories, known.key);
  if (!category) return null;
  return {
    categoryId: category.id,
    reason: known.source,
    ruleId: null,
    confidence: known.confidence,
    autoConfirm: known.confidence >= AI_CONFIDENT,
  };
}

function dictionaryKey(input: CategoriseInput, ctx: CategoriserContext): KnownMerchant | null {
  const builtin = lookupBuiltin(input.counterparty, input.vpa);
  if (builtin) return { key: builtin.key, confidence: DICTIONARY_CONFIDENCE, source: 'dictionary' };
  if (!input.counterparty || !ctx.knownMerchant) return null;
  return ctx.knownMerchant(normaliseMerchant(input.counterparty));
}

/**
 * CAT-3: the rule offered after a correction ("always do this for this
 * merchant"). Prefers the merchant name; falls back to the UPI ID when the
 * entry has no name. Null when the entry has neither.
 */
export function ruleFromEntry(entry: { counterparty: string | null; vpa: string | null; direction: 'debit' | 'credit' }): RuleMatch | null {
  if (entry.counterparty && !entry.counterparty.includes('@')) {
    return { kind: 'rule', merchant: normaliseMerchant(entry.counterparty), direction: entry.direction };
  }
  const vpa = entry.vpa ?? (entry.counterparty?.includes('@') ? entry.counterparty : null);
  return vpa ? { kind: 'rule', vpa: vpa.toLowerCase(), direction: entry.direction } : null;
}
