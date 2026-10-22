import type { Paise } from '@money-plant/core';
import { normaliseMerchant } from './dictionary';

export type Direction = 'debit' | 'credit';
export type PayeeKind = 'person' | 'business';

/** Why an entry has its category (CAT-6). `user` means the user picked it. */
export const CATEGORY_REASONS = ['rule', 'pattern', 'dictionary', 'ai', 'user'] as const;
export type CategoryReason = (typeof CATEGORY_REASONS)[number];

/**
 * A user rule (CAT-3): "always put this merchant, UPI ID or keyword in this
 * category". At least one of merchant, vpa or keyword is set.
 */
export interface RuleMatch {
  kind: 'rule';
  /** Normalised merchant name (see normaliseMerchant), compared exactly. */
  merchant?: string;
  /** Full UPI ID, lowercase. */
  vpa?: string;
  /** Normalised text the merchant label must contain. */
  keyword?: string;
  minAmount?: Paise;
  maxAmount?: Paise;
  direction?: Direction;
}

/** A learned pattern (CAT-8): time of day, weekdays, amount band, account and payee kind. */
export interface PatternMatch {
  kind: 'pattern';
  direction: Direction;
  minAmount: Paise;
  maxAmount: Paise;
  /** Local minutes after midnight, inclusive start and exclusive end. */
  startMinute: number;
  endMinute: number;
  /** 0 is Sunday. */
  weekdays: number[];
  accountId: string | null;
  payeeKind: PayeeKind | null;
}

export type RuleStatus = 'active' | 'paused' | 'proposed' | 'declined';

export interface Rule {
  id: string;
  match: RuleMatch | PatternMatch;
  categoryId: string;
  status: RuleStatus;
  /** Matches are confirmed directly instead of waiting in review. */
  autoConfirm: boolean;
  hits: number;
  misses: number;
}

/** What the categoriser knows about an entry. Amount is always positive. */
export interface CategoriseInput {
  direction: Direction;
  amount: Paise;
  counterparty: string | null;
  vpa: string | null;
  accountId: string;
  /** Local time features of the entry, see localTime. */
  minuteOfDay: number;
  weekday: number;
  payeeKind: PayeeKind;
}

/** Minutes after midnight and weekday of an instant, for a time zone offset in minutes (IST is 330). */
export function localTime(iso: string, offsetMinutes: number): { minuteOfDay: number; weekday: number } {
  const shifted = new Date(Date.parse(iso) + offsetMinutes * 60_000);
  return { minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(), weekday: shifted.getUTCDay() };
}

function inAmount(amount: number, min: number | undefined, max: number | undefined): boolean {
  return (min === undefined || amount >= min) && (max === undefined || amount <= max);
}

export function ruleMatches(match: RuleMatch, input: CategoriseInput): boolean {
  if (match.direction && match.direction !== input.direction) return false;
  if (!inAmount(input.amount, match.minAmount, match.maxAmount)) return false;
  if (!match.merchant && !match.vpa && !match.keyword) return false;
  const label = input.counterparty ? normaliseMerchant(input.counterparty) : null;
  if (match.vpa && input.vpa?.toLowerCase() !== match.vpa) return false;
  if (match.merchant && label !== match.merchant) return false;
  if (match.keyword && !label?.includes(match.keyword)) return false;
  return true;
}

export function patternMatches(match: PatternMatch, input: CategoriseInput): boolean {
  return (
    match.direction === input.direction &&
    inAmount(input.amount, match.minAmount, match.maxAmount) &&
    input.minuteOfDay >= match.startMinute &&
    input.minuteOfDay < match.endMinute &&
    match.weekdays.includes(input.weekday) &&
    (match.accountId === null || match.accountId === input.accountId) &&
    (match.payeeKind === null || match.payeeKind === input.payeeKind)
  );
}

/** More specific rules win: a UPI ID beats a merchant name, which beats a keyword; an amount range adds to it. */
export function ruleSpecificity(match: RuleMatch): number {
  return (
    (match.vpa ? 8 : 0) +
    (match.merchant ? 4 : 0) +
    (match.keyword ? 2 : 0) +
    (match.minAmount !== undefined || match.maxAmount !== undefined ? 1 : 0)
  );
}
