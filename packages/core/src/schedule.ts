/**
 * Calendar dates for recurring payments and due dates (REC-1 to REC-4, IOU-1).
 * A date is "2026-10-25" on the phone's clock, like MonthKey in budget.ts.
 */
export type DateKey = string;

export const CADENCES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

/** Rough length of each cadence in days, for detection and for "is it still active". */
export const CADENCE_DAYS: Record<Cadence, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(date: Date): DateKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local date an ISO timestamp falls on. */
export function dateOf(iso: string): DateKey {
  return dateKey(new Date(iso));
}

export function isDateKey(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Local midnight at the start of a date. */
export function startOfDate(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(key: DateKey, days: number): DateKey {
  const start = startOfDate(key);
  return dateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + days));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Safe across daylight saving changes. */
export function daysBetween(from: DateKey, to: DateKey): number {
  const a = startOfDate(from);
  const b = startOfDate(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
}

/**
 * The next due date after `key`. Monthly and longer cadences keep `anchorDay`
 * (the day of the month the payment is due), so a payment due on the 31st
 * falls on 30 Nov and 28 Feb, then back on 31 Mar.
 */
export function nextOccurrence(key: DateKey, cadence: Cadence, anchorDay?: number | null): DateKey {
  if (cadence === 'weekly') return addDays(key, 7);
  const months = cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : 12;
  const start = startOfDate(key);
  const day = anchorDay ?? start.getDate();
  const year = start.getFullYear();
  const month = start.getMonth() + months;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return dateKey(new Date(year, month, Math.min(day, lastDay)));
}
