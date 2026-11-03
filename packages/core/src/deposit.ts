import { paise, type Paise } from './money';
import { addDays, addMonthsToDate, daysBetween, type DateKey } from './schedule';

export type DepositKind = 'fd' | 'rd' | 'ppf' | 'epf' | 'nsc' | 'kvp' | 'ssy';

/** Long-term savings schemes (NW-6, decision 0014). */
export type SchemeKind = Exclude<DepositKind, 'fd' | 'rd'>;

export interface SchemeInfo {
  label: string;
  long: string;
  /** Current government rate in basis points, pre-filled and editable. */
  rateBp: number;
  /** Months from opening to maturity, or null when it has none the app tracks (EPF). */
  months: number | null;
  /**
   * How the value is worked out: `lump` like an FD compounding yearly (NSC,
   * KVP); `balance` from the money actually paid in, with interest on each
   * month's lowest balance after the 5th, credited every 31 March (PPF,
   * Sukanya Samriddhi, EPF).
   */
  model: 'lump' | 'balance';
}

/** Rates for October to December 2026; the user can change them. */
export const SCHEMES: Record<SchemeKind, SchemeInfo> = {
  ppf: { label: 'PPF', long: 'Public Provident Fund', rateBp: 710, months: 180, model: 'balance' },
  epf: { label: 'EPF', long: "Employees' Provident Fund", rateBp: 825, months: null, model: 'balance' },
  nsc: { label: 'NSC', long: 'National Savings Certificate', rateBp: 770, months: 60, model: 'lump' },
  kvp: { label: 'KVP', long: 'Kisan Vikas Patra', rateBp: 750, months: 115, model: 'lump' },
  ssy: { label: 'Sukanya Samriddhi', long: 'Sukanya Samriddhi Yojana', rateBp: 820, months: 252, model: 'balance' },
};

export function isScheme(kind: DepositKind): kind is SchemeKind {
  return kind !== 'fd' && kind !== 'rd';
}

/** PPF, EPF and Sukanya Samriddhi: valued from what was actually paid in, not a schedule. */
export function isBalanceScheme(kind: DepositKind): boolean {
  return isScheme(kind) && SCHEMES[kind].model === 'balance';
}
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
 * Indian banks compound deposit interest quarterly; NSC and KVP compound
 * yearly. Interest is worked out with the rate as a fraction and rounded to
 * whole paise once per instalment, so the result is always an integer amount.
 */
function grow(amount: Paise, rateBp: number, days: number, perYear: number): number {
  if (days <= 0) return amount;
  const periods = (days / 365) * perYear;
  return amount * (1 + rateBp / 10_000 / perYear) ** periods;
}

const compoundsPerYear = (kind: DepositKind) => (isScheme(kind) ? 1 : 4);

/** RD instalment due dates: the start date, then the same day each month, before maturity. */
export function instalmentDates(terms: DepositTerms): DateKey[] {
  if (isBalanceScheme(terms.kind)) return [];
  if (terms.kind !== 'rd') return [terms.startDate];
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
  for (const due of instalmentsDue(terms, until)) total += Math.round(grow(terms.amount, terms.rateBp, daysBetween(due, until), compoundsPerYear(terms.kind)));
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
  // PPF and Sukanya Samriddhi take any amount, so only a named payee identifies them; EPF is paid by the employer.
  if (isBalanceScheme(terms.kind)) {
    return terms.kind !== 'epf' && !!payee?.trim() && payeeMatches(payee, debit.counterparty) && debit.on >= terms.startDate && debit.on < terms.maturityDate;
  }
  if (debit.amount !== terms.amount || !payeeMatches(payee, debit.counterparty)) return false;
  return instalmentDates(terms).some((due) => Math.abs(daysBetween(due, debit.on)) <= DEPOSIT_WINDOW_DAYS);
}

/**
 * The credit that paid the deposit back: from 3 days before maturity to 10
 * days after, within 2% (or ₹100) of the expected maturity amount.
 */
export function isMaturityCredit(terms: DepositTerms, credit: DepositPayment): boolean {
  if (isBalanceScheme(terms.kind)) return false;
  if (credit.on < addDays(terms.maturityDate, -DEPOSIT_WINDOW_DAYS) || credit.on > addDays(terms.maturityDate, 10)) return false;
  const expected = maturityValue(terms);
  return Math.abs(credit.amount - expected) <= Math.max(expected * 0.02, 10_000);
}

/** Money in or out of a scheme's account on a day. */
export interface DatedFlow {
  on: DateKey;
  amount: Paise;
}

/**
 * NW-6: what a PPF, Sukanya Samriddhi or EPF account is worth on a day.
 * Interest for each month is on the lowest balance between the 5th and the
 * month's end (money in by the 5th counts that month), at the yearly rate
 * over 12, and is added to the balance every 31 March. The month in progress
 * earns nothing yet. `flows` start with the balance on a day the user knew it
 * (a passbook figure), then every payment in or out since.
 */
export function balanceSchemeValue(flows: readonly DatedFlow[], rateBp: number, on: DateKey): { value: Paise; interest: Paise } {
  const sorted = [...flows].filter((f) => f.on <= on).sort((a, b) => a.on.localeCompare(b.on));
  const paid = sorted.reduce((sum, f) => sum + f.amount, 0);
  if (sorted.length === 0) return { value: paise(0), interest: paise(0) };
  let credited = 0;
  let pending = 0;
  let next = 0;
  let balance = 0;
  // Month by month, from the first flow's month up to the last month that has ended.
  let year = Number(sorted[0]!.on.slice(0, 4));
  let month = Number(sorted[0]!.on.slice(5, 7));
  const endYear = Number(on.slice(0, 4));
  const endMonth = Number(on.slice(5, 7));
  while (year < endYear || (year === endYear && month < endMonth)) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const fifth = `${ym}-05`;
    // Money in by the 5th counts for this month; money out any time in the month lowers it.
    let byFifth = balance;
    let laterOut = 0;
    while (next < sorted.length && sorted[next]!.on.slice(0, 7) <= ym) {
      const f = sorted[next]!;
      balance += f.amount;
      if (f.on <= fifth) byFifth += f.amount;
      else if (f.amount < 0) laterOut += f.amount;
      next++;
    }
    const low = byFifth + laterOut;
    pending += (Math.max(low, 0) + credited) * (rateBp / 10_000 / 12);
    if (month === 3) {
      credited += Math.round(pending);
      pending = 0;
    }
    month++;
    if (month === 13) {
      month = 1;
      year++;
    }
  }
  const interest = credited + Math.round(pending);
  return { value: paise(paid + interest), interest: paise(interest) };
}
