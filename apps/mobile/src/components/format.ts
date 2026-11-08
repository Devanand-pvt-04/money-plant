import { currencyInfo, formatMoney, type CurrencyCode } from '@money-plant/core';
import { homeCurrency } from '@/lib/home-currency';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 Oct, 14:32" in the phone's time zone. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

/** "21 Oct 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026" for "2026-10". */
export function formatMonth(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}

/**
 * Whole units, "₹1,250" or "$1,250", for summaries where paise and cents are
 * noise. In the home currency unless another is given (decision 0017).
 */
export function formatWholeRupees(amount: number, currency: CurrencyCode = homeCurrency()): string {
  const { decimals } = currencyInfo(currency);
  const unit = 10 ** decimals;
  const rounded = Math.round(amount / unit) * unit;
  const text = formatMoney(rounded, currency);
  return decimals ? text.slice(0, -(decimals + 1)) : text;
}

/** Same as formatWholeRupees, under a name that doesn't say rupees. */
export const formatWhole = formatWholeRupees;

/** How long a review of `count` entries takes, at about 8 seconds each: "under a minute", "about 5 minutes". */
export function reviewTime(count: number): string {
  const minutes = Math.round((count * 8) / 60);
  if (minutes < 1) return 'under a minute';
  if (minutes < 90) return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return `about ${Math.round(minutes / 60)} hours`;
}

/** "₹480" or "₹480.50": exact, without ".00" noise. In the home currency unless another is given. */
export function formatAmount(amount: number, currency: CurrencyCode = homeCurrency()): string {
  const { decimals } = currencyInfo(currency);
  const unit = 10 ** decimals;
  if (amount % unit === 0) return formatWholeRupees(amount, currency);
  return formatMoney(amount, currency);
}

/** Money out as "−₹480", money in as "+₹480". */
export function formatSigned(amount: number, currency: CurrencyCode = homeCurrency()): string {
  return `${amount < 0 ? '−' : '+'}${formatAmount(Math.abs(amount), currency)}`;
}

/** "1:42 pm". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Yesterday" or "Mon, 20 Oct", for grouping a list by day. */
export function formatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const name = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  return `${name}, ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}
