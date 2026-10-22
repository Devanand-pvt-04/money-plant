import type { Paise } from './money';

/** A balance the bank reported at a moment, from an SMS or a statement. */
export interface BalanceAnchorPoint {
  observedAt: string;
  balance: Paise;
}

export interface DatedAmount {
  occurredAt: string;
  amount: Paise;
}

export interface AnchorCheck {
  anchor: BalanceAnchorPoint;
  /** Ledger balance at the anchor's moment: opening balance plus postings up to and including it. */
  computed: Paise;
  /** anchor.balance - computed. Positive means the ledger is missing money. */
  gap: Paise;
}

export interface Reconciliation {
  latest: AnchorCheck;
  /** True when the latest gap is more than ₹1 either way (LED-7). */
  flagged: boolean;
  /**
   * Where to look for the missing or wrong entry: after the last anchor whose
   * gap was the same as before the change, up to the latest anchor.
   */
  windowStart: string | null;
}

/** ₹1. Banks round some charges, so smaller gaps are not worth a review item. */
export const RECONCILE_TOLERANCE = 100;

/**
 * Compares each balance the bank reported with the ledger's balance at that
 * moment. Returns null when there are no anchors.
 */
export function reconcile(
  openingBalance: Paise,
  postings: readonly DatedAmount[],
  anchors: readonly BalanceAnchorPoint[],
): Reconciliation | null {
  if (anchors.length === 0) return null;
  const sortedPostings = [...postings].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const sortedAnchors = [...anchors].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  const checks: AnchorCheck[] = [];
  let running: number = openingBalance;
  let next = 0;
  for (const anchor of sortedAnchors) {
    const at = Date.parse(anchor.observedAt);
    while (next < sortedPostings.length && Date.parse(sortedPostings[next]!.occurredAt) <= at) {
      running += sortedPostings[next]!.amount;
      next++;
    }
    checks.push({ anchor, computed: running as Paise, gap: (anchor.balance - running) as Paise });
  }

  const latest = checks[checks.length - 1]!;
  const flagged = Math.abs(latest.gap) > RECONCILE_TOLERANCE;
  let windowStart: string | null = null;
  if (flagged) {
    for (let i = checks.length - 2; i >= 0; i--) {
      if (Math.abs(checks[i]!.gap - latest.gap) > RECONCILE_TOLERANCE) {
        windowStart = checks[i]!.anchor.observedAt;
        break;
      }
    }
  }
  return { latest, flagged, windowStart };
}
