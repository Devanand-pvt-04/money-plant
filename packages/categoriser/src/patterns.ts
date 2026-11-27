import { formatMoney, formatRupees, paise, type CurrencyCode, type Paise } from '@money-plant/core';
import type { Direction, PatternMatch, PayeeKind, Rule } from './rules';

/** A pattern rule (CAT-8), as opposed to a payee rule. */
type PatternRule = Rule & { match: PatternMatch };
const isPattern = (rule: Rule): rule is PatternRule => rule.match.kind === 'pattern';

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
  /**
   * Decision 0033: the pattern this one widens, when the corrections sit just
   * outside a pattern the user already has (a new price, a later time). The
   * proposal's match covers both.
   */
  replaces?: string;
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
 * times in one 2-hour window. Returns at most one proposal per category.
 *
 * Decision 0033: when the corrections sit near a pattern the user already has
 * for that category (a new price, a later time), the proposal widens that
 * pattern instead of starting a second one. A pattern already proposed, or one
 * that already covers the corrections, means no proposal. A declined idea is
 * not offered again until 3 corrections fall outside what was declined.
 */
export function proposePatterns(corrections: readonly Correction[], existing: readonly Rule[], now: Date): PatternProposal[] {
  const since = now.getTime() - LEARN_WINDOW_DAYS * DAY;
  const recent = corrections.filter((c) => Date.parse(c.occurredAt) >= since);
  const groups = new Map<string, Correction[]>();
  for (const c of recent) {
    const key = [c.categoryId, c.direction, c.accountId, c.payeeKind].join('|');
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const patterns = existing.filter(isPattern);

  const proposals: PatternProposal[] = [];
  for (const group of groups.values()) {
    if (group.length < LEARN_MIN_CORRECTIONS) continue;
    const cluster = largestCluster(group);
    if (cluster.length < LEARN_MIN_CORRECTIONS) continue;
    const first = cluster[0]!;
    if (proposals.some((p) => p.categoryId === first.categoryId)) continue;
    const match = patternFor(cluster);
    const mine = patterns.filter((rule) => rule.categoryId === first.categoryId);
    // Only new behaviour counts: a pattern is left alone until 3 corrections fall outside it.
    const settled = (rule: PatternRule) => cluster.filter((c) => !correctionMatches(rule.match, c)).length < LEARN_MIN_CORRECTIONS;
    if (mine.some((rule) => rule.status === 'proposed' && overlaps(rule.match, match))) continue;
    if (mine.some((rule) => rule.status === 'declined' && overlaps(rule.match, match) && settled(rule))) continue;
    const own = mine.filter((rule) => rule.status === 'active' || rule.status === 'paused');
    const near = own.find((rule) => sameScope(rule.match, match) && isNear(rule.match, match));
    if (near) {
      if (settled(near)) continue;
      const widened = union(near.match, match);
      if (mine.some((rule) => rule.status === 'declined' && contains(rule.match, widened))) continue;
      proposals.push({ match: widened, categoryId: first.categoryId, transactionIds: newestFirst(cluster), replaces: near.id });
      continue;
    }
    if (own.some((rule) => overlaps(rule.match, match))) continue;
    proposals.push({ match, categoryId: first.categoryId, transactionIds: newestFirst(cluster) });
  }
  return proposals;
}

const newestFirst = (cluster: readonly Correction[]) =>
  [...cluster].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).map((c) => c.transactionId);

/** Whether a correction is one the pattern would have placed. */
function correctionMatches(match: PatternMatch, c: Correction): boolean {
  return (
    match.direction === c.direction &&
    c.amount >= match.minAmount &&
    c.amount <= match.maxAmount &&
    c.minuteOfDay >= match.startMinute &&
    c.minuteOfDay < match.endMinute &&
    match.weekdays.includes(c.weekday) &&
    (match.accountId === null || match.accountId === c.accountId) &&
    (match.payeeKind === null || match.payeeKind === c.payeeKind)
  );
}

/** Same direction, account and payee kind, on some of the same days: one habit, so one pattern. */
function sameScope(a: PatternMatch, b: PatternMatch): boolean {
  return a.direction === b.direction && a.accountId === b.accountId && a.payeeKind === b.payeeKind && a.weekdays.some((d) => b.weekdays.includes(d));
}

/** How far outside a pattern new behaviour may sit and still widen it: a quarter of its top amount, an hour either side. */
const NEAR_AMOUNT = 0.25;
const NEAR_MINUTES = 60;

function isNear(existing: PatternMatch, next: PatternMatch): boolean {
  const slack = Math.ceil(existing.maxAmount * NEAR_AMOUNT);
  return (
    next.minAmount <= existing.maxAmount + slack &&
    next.maxAmount >= existing.minAmount - slack &&
    next.startMinute <= existing.endMinute + NEAR_MINUTES &&
    next.endMinute >= existing.startMinute - NEAR_MINUTES
  );
}

/** One pattern covering both: the wider amounts, hours and days. */
function union(a: PatternMatch, b: PatternMatch): PatternMatch {
  const days = new Set([...a.weekdays, ...b.weekdays]);
  return {
    ...a,
    minAmount: paise(Math.min(a.minAmount, b.minAmount)),
    maxAmount: paise(Math.max(a.maxAmount, b.maxAmount)),
    startMinute: Math.min(a.startMinute, b.startMinute),
    endMinute: Math.max(a.endMinute, b.endMinute),
    weekdays: EVERY_DAY.filter((d) => days.has(d)),
  };
}

/** Whether `outer` places everything `inner` does. */
function contains(outer: PatternMatch, inner: PatternMatch): boolean {
  return (
    sameScope(outer, inner) &&
    outer.minAmount <= inner.minAmount &&
    outer.maxAmount >= inner.maxAmount &&
    outer.startMinute <= inner.startMinute &&
    outer.endMinute >= inner.endMinute &&
    inner.weekdays.every((d) => outer.weekdays.includes(d))
  );
}

/**
 * Decision 0033: the pattern a proposal would widen, if it is one: the user's
 * own pattern for that category that the proposal covers completely.
 */
export function widenedPattern(proposal: Rule, rules: readonly Rule[]): PatternRule | null {
  if (!isPattern(proposal)) return null;
  return (
    rules
      .filter(isPattern)
      .find((rule) => rule.id !== proposal.id && rule.categoryId === proposal.categoryId && (rule.status === 'active' || rule.status === 'paused') && contains(proposal.match, rule.match)) ??
    null
  );
}

export const PAUSE_MIN_MISSES = 3;

/**
 * Decision 0033: an active pattern the user keeps correcting is offered for
 * pausing: at least 3 corrections, more than it got right. `keptAtMisses` is
 * the corrections count when the user last chose to keep it; it is asked
 * again only after 3 more.
 */
export function shouldOfferPause(rule: Rule, keptAtMisses: number | null): boolean {
  if (!isPattern(rule) || rule.status !== 'active') return false;
  if (rule.misses < PAUSE_MIN_MISSES || rule.misses <= rule.hits) return false;
  return keptAtMisses === null || rule.misses >= keptAtMisses + PAUSE_MIN_MISSES;
}

export const TRUST_MIN_RIGHT = 8;

/**
 * Decision 0037: a pattern that still asks first but keeps being right is
 * offered to file by itself: at least 8 right, and right at least 8 times for
 * every correction. `askedAtRight` is the right count when the user last said
 * keep asking; it is asked again only after 8 more right.
 */
export function shouldOfferAutoConfirm(rule: Rule, askedAtRight: number | null): boolean {
  if (!isPattern(rule) || rule.status !== 'active' || rule.autoConfirm) return false;
  if (rule.hits < TRUST_MIN_RIGHT || rule.hits < rule.misses * TRUST_MIN_RIGHT) return false;
  return askedAtRight === null || rule.hits >= askedAtRight + TRUST_MIN_RIGHT;
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

/** A pattern's conditions as short labels, one per chip on the Rules screen (decision 0037). */
export interface PatternParts {
  time: string;
  days: string;
  amount: string;
  payee: string | null;
  account: string | null;
}

export function patternParts(match: PatternMatch, account: { name: string; currency: CurrencyCode } | null): PatternParts {
  const money = (amount: Paise) => (account ? formatMoney(amount, account.currency) : formatRupees(amount)).replace(/\.00$/, '');
  const dayLabel = days(match.weekdays);
  return {
    time: `${clock(match.startMinute)} to ${clock(match.endMinute)}`,
    days: dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1),
    amount: `${money(match.minAmount)} to ${money(match.maxAmount)}`,
    payee: match.payeeKind === 'person' ? (match.direction === 'debit' ? 'To a person' : 'From a person') : match.payeeKind === 'business' ? 'Businesses' : null,
    account: account ? `${match.direction === 'debit' ? 'From' : 'Into'} ${account.name}` : null,
  };
}
