import { paise, type Paise } from './money';
import { addDays, addMonthsToDate, daysBetween, type DateKey } from './schedule';

export type DepositKind = 'fd' | 'rd';
/** What an FD does with its interest: add it to the deposit, or pay it out every month or quarter. RDs always reinvest. */
export type DepositPayout = 'reinvest' | 'monthly' | 'quarterly';

/** The terms of an FD or RD (NW-2). */
export interface DepositTerms {
  kind: DepositKind;
  /** The principal for an FD, the monthly instalment for an RD. */
  amount: Paise;
  /** Yearly interest rate in basis points: 7.25% is 725. */
  rateBp: number;
  startDate: DateKey;
  maturityDate: DateKey;
  payout: DepositPayout;
}

/**
 * Indian banks compound deposit interest quarterly. Interest is worked out
 * with the rate as a fraction and rounded to whole paise once per instalment,
 * so the result is always an integer amount.
 */
function grow(amount: Paise, rateBp: number, days: number): number {
  if (days <= 0) return amount;
  const quarters = (days / 365) * 4;
  return amount * (1 + rateBp / 10_000 / 4) ** quarters;
}

/** RD instalment due dates: the start date, then the same day each month, before maturity. */
export function instalmentDates(terms: DepositTerms): DateKey[] {
  if (terms.kind === 'fd') return [terms.startDate];
  const dates: DateKey[] = [];
  for (let k = 0; k < 600; k++) {
    const due = addMonthsToDate(terms.startDate, k);
    if (due >= terms.maturityDate) break;
    dates.push(due);
  }
  return dates;
}

/** Instalments due on or before `on`. */
export function instalmentsDue(terms: DepositTerms, on: DateKey): DateKey[] {
  return instalmentDates(terms).filter((due) => due <= on);
}

/** What has gone into the deposit by `on`, without interest. */
export function paidIn(terms: DepositTerms, on: DateKey): Paise {
  return paise(instalmentsDue(terms, on).length * terms.amount);
}

/**
 * NW-1: the deposit's value on a date: what went in plus the interest earned
 * so far, up to maturity. An FD that pays its interest out stays at its
 * principal, since the interest reaches the bank account instead.
 */
export function valueOn(terms: DepositTerms, on: DateKey): Paise {
  const until = on < terms.maturityDate ? on : terms.maturityDate;
  if (terms.kind === 'fd' && terms.payout !== 'reinvest') return paidIn(terms, until);
  let total = 0;
  for (const due of instalmentsDue(terms, until)) total += Math.round(grow(terms.amount, terms.rateBp, daysBetween(due, until)));
  return paise(total);
}

export function maturityValue(terms: DepositTerms): Paise {
  return valueOn(terms, terms.maturityDate);
}

/** Interest earned so far, on top of what went in. */
export function interestOn(terms: DepositTerms, on: DateKey): Paise {
  return paise(valueOn(terms, on) - paidIn(terms, on));
}

/** For an FD that pays interest out: the amount of each payout. */
export function payoutAmount(terms: DepositTerms): Paise | null {
  if (terms.kind !== 'fd' || terms.payout === 'reinvest') return null;
  const perYear = terms.payout === 'monthly' ? 12 : 4;
  return paise(Math.round((terms.amount * terms.rateBp) / 10_000 / perYear));
}

/** A debit or credit seen in the ledger, to match against a deposit. */
export interface DepositPayment {
  amount: Paise;
  on: DateKey;
  counterparty: string | null;
}

/** Days either side of a due date that a payment still counts. */
export const DEPOSIT_WINDOW_DAYS = 3;

const payeeMatches = (payee: string | null, counterparty: string | null) =>
  payee === null || payee.trim() === '' || (counterparty ?? '').toUpperCase().includes(payee.trim().toUpperCase());

/**
 * A debit that paid into the deposit: an RD instalment (the instalment amount
 * to the deposit's payee, within 3 days of a due date) or the FD's opening
 * payment (the principal, within 3 days of the start date).
 */
export function isDepositPayment(terms: DepositTerms, payee: string | null, debit: DepositPayment): boolean {
  if (debit.amount !== terms.amount || !payeeMatches(payee, debit.counterparty)) return false;
  return instalmentDates(terms).some((due) => Math.abs(daysBetween(due, debit.on)) <= DEPOSIT_WINDOW_DAYS);
}

/**
 * The credit that paid the deposit back: from 3 days before maturity to 10
 * days after, within 2% (or ₹100) of the expected maturity amount.
 */
export function isMaturityCredit(terms: DepositTerms, credit: DepositPayment): boolean {
  if (credit.on < addDays(terms.maturityDate, -DEPOSIT_WINDOW_DAYS) || credit.on > addDays(terms.maturityDate, 10)) return false;
  const expected = maturityValue(terms);
  return Math.abs(credit.amount - expected) <= Math.max(expected * 0.02, 10_000);
}
