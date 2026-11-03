import { normaliseMerchant } from '@money-plant/categoriser';
import type { Paise } from '@money-plant/core';
import type { LedgerTransaction } from './types';

/** A refund is matched to a payment from this many days before it. */
export const REFUND_WINDOW_DAYS = 60;

export interface RefundCredit {
  /** The user's account the money came back to. */
  accountId: string;
  /** Positive. */
  amount: Paise;
  counterparty: string | null;
  occurredAt: string;
}

const REFUND_WORDS = /\b(?:refund(?:ed)?|reversal|reversed|rev|chargeback)\b/gi;

/** A payee name without refund words, normalised, or null when nothing is left. */
function payeeOf(name: string | null): string | null {
  if (!name) return null;
  const cleaned = normaliseMerchant(name.replace(REFUND_WORDS, ' '));
  return cleaned || null;
}

/** Names match when equal, or when one holds the other ("amazon" in "amazon pay"); very short names must be equal. */
const samePayee = (a: string | null, b: string | null) =>
  a !== null && b !== null && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))));

/**
 * LED-5: the payment a refund or reversal gives money back for. It left the
 * same account in the 60 days before and was at least as large, and either
 * went to the same payee or was for exactly the same amount. The same payee
 * wins, then an exact amount, then the most recent.
 */
export function findRefunded(refund: RefundCredit, candidates: readonly LedgerTransaction[]): LedgerTransaction | null {
  const before = Date.parse(refund.occurredAt);
  const from = before - REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const payee = payeeOf(refund.counterparty);
  const paid = (tx: LedgerTransaction) => -(tx.postings.find((p) => p.accountId === refund.accountId)?.amount ?? 0);
  const scored = candidates
    .filter((tx) => {
      if (tx.kind !== 'expense') return false;
      const at = Date.parse(tx.occurredAt);
      return at <= before && at >= from && paid(tx) >= refund.amount;
    })
    .map((tx) => ({ tx, payee: samePayee(payee, payeeOf(tx.counterparty)), exact: paid(tx) === refund.amount }))
    .filter((c) => c.payee || c.exact);
  scored.sort((a, b) => Number(b.payee) - Number(a.payee) || Number(b.exact) - Number(a.exact) || b.tx.occurredAt.localeCompare(a.tx.occurredAt));
  return scored[0]?.tx ?? null;
}
