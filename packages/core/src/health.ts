import type { Paise } from './money';
import { RECONCILE_TOLERANCE } from './reconcile';

/**
 * HOME-3: the PRD's success metrics, measured on the phone (decision 0014).
 * Everything here is worked out from the local ledger; nothing is stored.
 */

/** Days the Health screen looks back over. */
export const HEALTH_DAYS = 30;

export const HEALTH_TARGETS = {
  /** Share of entries captured without typing (Android). */
  captured: 0.85,
  /** Share of automatic categories the user left as they were. */
  categories: 0.9,
  /** Seconds a day in Review. */
  reviewSeconds: 120,
  /** Gap between the ledger and the bank, either way. */
  balanceGap: RECONCILE_TOLERANCE,
} as const;

/** Where a category came from, as kept on the entry. */
const AUTOMATIC_REASONS = new Set(['rule', 'pattern', 'dictionary', 'ai', 'refund']);
/** Sources the user typed: anything else was captured for them. */
const TYPED_SOURCES = new Set(['manual', 'app_payment']);

export interface HealthEntry {
  kind: string;
  status: string;
  categoryReason: string | null;
  /** The kinds of the entry's sources (sms, statement, manual…). */
  sources: readonly string[];
}

export interface Share {
  /** Entries that count toward the target. */
  hits: number;
  total: number;
  /** hits / total, or null with nothing to count. */
  share: number | null;
  met: boolean | null;
}

export interface HealthFigures {
  captured: Share;
  categories: Share;
  review: { averageSeconds: number | null; days: number; met: boolean | null };
}

function share(hits: number, total: number, target: number): Share {
  if (total === 0) return { hits, total, share: null, met: null };
  const value = hits / total;
  return { hits, total, share: value, met: value >= target };
}

export function isCaptured(entry: HealthEntry): boolean {
  return entry.sources.some((kind) => !TYPED_SOURCES.has(kind));
}

/**
 * Captured: every money entry (not opening adjustments or IOU records) with a
 * source the user didn't type. Categories: confirmed, captured spending and
 * income with a category; a category set by a rule, pattern, the dictionary,
 * a refund match or the AI counts as accepted, one the user set as edited.
 * Review: average seconds on the days Review was open.
 */
export function healthFigures(entries: readonly HealthEntry[], reviewSecondsByDay: readonly number[]): HealthFigures {
  const money = entries.filter((e) => e.kind === 'expense' || e.kind === 'income' || e.kind === 'transfer');
  const captured = money.filter(isCaptured);

  const categorised = captured.filter(
    (e) => e.status === 'confirmed' && (e.kind === 'expense' || e.kind === 'income') && e.categoryReason !== null,
  );
  const accepted = categorised.filter((e) => AUTOMATIC_REASONS.has(e.categoryReason!));

  const days = reviewSecondsByDay.filter((s) => s > 0);
  const averageSeconds = days.length === 0 ? null : Math.round(days.reduce((sum, s) => sum + s, 0) / days.length);

  return {
    captured: share(captured.length, money.length, HEALTH_TARGETS.captured),
    categories: share(accepted.length, categorised.length, HEALTH_TARGETS.categories),
    review: {
      averageSeconds,
      days: days.length,
      met: averageSeconds === null ? null : averageSeconds <= HEALTH_TARGETS.reviewSeconds,
    },
  };
}

/** Whether a bank account's latest gap is within the target. */
export function balanceMet(gap: Paise): boolean {
  return Math.abs(gap) <= HEALTH_TARGETS.balanceGap;
}

/**
 * Adds seconds to a day in a per-day log and drops days older than the
 * window, so the log never grows. Days are yyyy-mm-dd on the phone's clock.
 */
export function addReviewSeconds(log: Readonly<Record<string, number>>, day: string, seconds: number, keepFrom: string): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [d, s] of Object.entries(log)) if (d >= keepFrom) next[d] = s;
  if (day >= keepFrom && seconds > 0) next[day] = (next[day] ?? 0) + Math.round(seconds);
  return next;
}
