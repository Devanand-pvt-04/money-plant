import { formatRupees, paise, type Paise } from '@money-plant/core';
import type { Direction, PatternMatch, PayeeKind, Rule } from './rules';

/** One entry the user categorised by hand, with the features patterns learn from (CAT-8). */
export interface Correction {
  transactionId: string;
  categoryId: string;
  direction: Direction;
  amount: Paise;
  accountId: string;
  payeeKind: PayeeKind;
  minuteOfDay: number;
  weekday: number;
  occurredAt: string;
}

export interface PatternProposal {
  match: PatternMatch;
  categoryId: string;
  /** The corrections that agree, newest first. */
  transactionIds: string[];
}

export const LEARN_WINDOW_DAYS = 30;
export const LEARN_MIN_CORRECTIONS = 3;
/** Amounts in one band: all within ±25% of a centre, so max ≤ min × 1.25 / 0.75. */
const BAND_RATIO = 1.25 / 0.75;
const TIME_WINDOW_MINUTES = 120;
const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * Looks for 3 or more corrections to the same category in the last 30 days that
 * share direction, account and payee kind, with amounts in one ±25% band and
 * times in one 2-hour window. Skips anything an existing pattern (in any
 * status, including declined) already covers, so a declined idea is not
 * offered again. Returns at most one proposal per category.
 */
export function proposePatterns(corrections: readonly Correction[], existing: readonly Rule[], now: Date): PatternProposal[] {
  const since = now.getTime() - LEARN_WINDOW_DAYS * DAY;
  const recent = corrections.filter((c) => Date.parse(c.occurredAt) >= since);
  const groups = new Map<string, Correction[]>();
  for (const c of recent) {
    const key = [c.categoryId, c.direction, c.accountId, c.payeeKind].join('|');
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const proposals: PatternProposal[] = [];
  for (const group of groups.values()) {
    if (group.length < LEARN_MIN_CORRECTIONS) continue;
    const cluster = largestCluster(group);
    if (cluster.length < LEARN_MIN_CORRECTIONS) continue;
    const first = cluster[0]!;
    const match = patternFor(cluster);
    const covered = existing.some(
      (rule) => rule.match.kind === 'pattern' && rule.categoryId === first.categoryId && overlaps(rule.match, match),
    );
    if (covered) continue;
    if (proposals.some((p) => p.categoryId === first.categoryId)) continue;
    proposals.push({
      match,
      categoryId: first.categoryId,
      transactionIds: [...cluster].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).map((c) => c.transactionId),
    });
  }
  return proposals;
}

/** The biggest set of corrections that fits one time window and one amount band. */
function largestCluster(group: readonly Correction[]): Correction[] {
  const byTime = [...group].sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  let best: Correction[] = [];
  for (const start of byTime) {
    const inWindow = byTime
      .filter((c) => c.minuteOfDay >= start.minuteOfDay && c.minuteOfDay < start.minuteOfDay + TIME_WINDOW_MINUTES)
      .sort((a, b) => a.amount - b.amount);
    for (let i = 0; i < inWindow.length; i++) {
      let j = i;
      while (j + 1 < inWindow.length && inWindow[j + 1]!.amount <= inWindow[i]!.amount * BAND_RATIO) j++;
      if (j - i + 1 > best.length) best = inWindow.slice(i, j + 1);
    }
  }
  return best;
}

const HOUR = 60;

function patternFor(cluster: readonly Correction[]): PatternMatch {
  const first = cluster[0]!;
  const amounts = cluster.map((c) => c.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  // Widen to ±25% of the middle of the band, in whole rupees, so the next fare a little off still matches.
  const centre = (low + high) / 2;
  const minAmount = paise(Math.min(low, Math.floor((centre * 0.75) / 100) * 100));
  const maxAmount = paise(Math.max(high, Math.ceil((centre * 1.25) / 100) * 100));
  const minutes = cluster.map((c) => c.minuteOfDay);
  const startMinute = Math.floor(Math.min(...minutes) / HOUR) * HOUR;
  const endMinute = Math.min(24 * HOUR, Math.max(startMinute + HOUR, Math.ceil((Math.max(...minutes) + 1) / HOUR) * HOUR));
  const days = new Set(cluster.map((c) => c.weekday));
  const weekdays = [...days].every((d) => WEEKDAYS.includes(d))
    ? WEEKDAYS
    : [...days].every((d) => WEEKEND.includes(d))
      ? WEEKEND
      : EVERY_DAY;
  return {
    kind: 'pattern',
    direction: first.direction,
    minAmount,
    maxAmount,
    startMinute,
    endMinute,
    weekdays,
    accountId: first.accountId,
    payeeKind: first.payeeKind,
  };
}

function overlaps(a: PatternMatch, b: PatternMatch): boolean {
  return (
    a.direction === b.direction &&
    a.minAmount <= b.maxAmount &&
    b.minAmount <= a.maxAmount &&
    a.startMinute < b.endMinute &&
    b.startMinute < a.endMinute &&
    a.weekdays.some((d) => b.weekdays.includes(d))
  );
}

function clock(minute: number): string {
  const h = Math.floor(minute / HOUR) % 24;
  const m = minute % HOUR;
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function days(weekdays: readonly number[]): string {
  const key = [...weekdays].sort().join(',');
  if (key === WEEKDAYS.join(',')) return 'weekdays';
  if (key === WEEKEND.join(',')) return 'weekends';
  if (key === EVERY_DAY.join(',')) return 'every day';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return [...weekdays].sort().map((d) => names[d]).join(', ');
}

const rupees = (amount: Paise) => formatRupees(amount).replace(/\.00$/, '');

/** "₹15 to ₹25 from HDFC Bank ••1234 to people, weekdays 8 to 10 am". */
export function describePattern(match: PatternMatch, accountName: string | null): string {
  const parts = [`${rupees(match.minAmount)} to ${rupees(match.maxAmount)}`];
  if (accountName) parts.push(`${match.direction === 'debit' ? 'from' : 'into'} ${accountName}`);
  if (match.payeeKind) parts.push(match.payeeKind === 'person' ? 'with people' : 'with businesses');
  return `${parts.join(' ')}, ${days(match.weekdays)} ${clock(match.startMinute)} to ${clock(match.endMinute)}`;
}
