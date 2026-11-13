import { addDays, daysBetween, startOfDate, type DateKey } from './schedule';
import type { Paise } from './money';

/**
 * Decision 0024: a credit card's billing cycle. The statement is made on the
 * same day each month (on the month's last day when it is shorter); the bill
 * is due a fixed number of days later.
 */

/** The statement date in the month of `key`, kept inside the month. */
function statementIn(year: number, month: number, day: number): DateKey {
  const last = new Date(year, month + 1, 0).getDate();
  const d = new Date(year, month, Math.min(day, last));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The latest statement date on or before `key`. */
export function lastStatementDate(key: DateKey, statementDay: number): DateKey {
  const date = startOfDate(key);
  const thisMonth = statementIn(date.getFullYear(), date.getMonth(), statementDay);
  return thisMonth <= key ? thisMonth : statementIn(date.getFullYear(), date.getMonth() - 1, statementDay);
}

/** The first statement date after `key`. */
export function nextStatementDate(key: DateKey, statementDay: number): DateKey {
  const date = startOfDate(key);
  const thisMonth = statementIn(date.getFullYear(), date.getMonth(), statementDay);
  return thisMonth > key ? thisMonth : statementIn(date.getFullYear(), date.getMonth() + 1, statementDay);
}

/** Statement SMS can arrive a few days after the statement is made. */
export const STATEMENT_SMS_DELAY_DAYS = 5;

/**
 * The statement date a statement SMS is for: the one it prints, else the
 * card's statement day if the SMS came within a few days of it, else the
 * day it arrived.
 */
export function statementDateFor(received: DateKey, printed: DateKey | null, statementDay: number | null): DateKey {
  if (printed) return printed;
  if (statementDay !== null) {
    const last = lastStatementDate(received, statementDay);
    if (daysBetween(last, received) <= STATEMENT_SMS_DELAY_DAYS) return last;
  }
  return received;
}

export interface CardBill {
  statementOn: DateKey;
  dueOn: DateKey | null;
  total: Paise;
  minimum: Paise | null;
}

export interface BillStatus {
  /** Paid into the card since the statement date. */
  paid: Paise;
  /** What is still due; zero once the bill is cleared. */
  remaining: Paise;
  cleared: boolean;
  /** Days until the due date; negative once it has passed. Null when no due date is known. */
  daysLeft: number | null;
}

/** Whether the payments into the card since the statement date clear its bill. */
export function billStatus(bill: CardBill, paidSince: Paise, today: DateKey): BillStatus {
  const remaining = Math.max(0, bill.total - paidSince) as Paise;
  return {
    paid: paidSince,
    remaining,
    cleared: remaining === 0,
    daysLeft: bill.dueOn ? daysBetween(today, bill.dueOn) : null,
  };
}

/** The due date of a bill: as printed, else the statement date plus the card's days to pay. */
export function dueDateFor(statementOn: DateKey, printed: DateKey | null, dueDays: number | null): DateKey | null {
  if (printed) return printed;
  return dueDays !== null ? addDays(statementOn, dueDays) : null;
}

/** The end of a statement day, as an ISO time: the bill covers everything up to then. */
export function statementEnd(on: DateKey): string {
  return new Date(startOfDate(addDays(on, 1)).getTime() - 1000).toISOString();
}
