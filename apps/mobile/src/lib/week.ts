import { addDays, daysBetween, DEFAULT_CURRENCY, type CurrencyCode, type DateKey, type Paise } from '@money-plant/core';
import { isOpen, listIous } from './ious';
import { today, upcomingPayments } from './recurring';
import { cardBillsDue } from './cards';

export interface DueItem {
  /** The day it shows on: overdue items show on today. */
  date: DateKey;
  overdue: boolean;
  title: string;
  amount: Paise;
  /** The amount's own currency (decision 0017). */
  currency: CurrencyCode;
  /** Money in: someone pays the user back. */
  incoming: boolean;
  href: `/recurring/${string}` | `/iou/${string}` | `/account/${string}`;
}

/** HOME-1: bills, EMIs, card bills and IOUs due in the next 7 days, today first. */
export async function weekAhead(): Promise<{ days: DateKey[]; items: DueItem[] }> {
  const start = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [payments, ious, cards] = await Promise.all([upcomingPayments(6), listIous(), cardBillsDue(start).catch(() => [])]);
  const items: DueItem[] = payments.map((u) => ({
    date: u.days < 0 ? start : addDays(start, u.days),
    overdue: u.overdue,
    title: u.item.name,
    amount: u.item.amount,
    currency: u.item.currency ?? DEFAULT_CURRENCY,
    incoming: false,
    href: `/recurring/${u.item.id}`,
  }));
  for (const view of ious) {
    if (!isOpen(view) || !view.dueDate) continue;
    const gap = daysBetween(start, view.dueDate);
    if (gap > 6) continue;
    const incoming = view.direction === 'lent';
    items.push({
      date: gap < 0 ? start : view.dueDate,
      overdue: gap < 0,
      title: incoming ? `${view.otherName} pays you back` : `Pay ${view.otherName} back`,
      amount: view.outstanding,
      currency: view.currency,
      incoming,
      href: `/iou/${view.id}`,
    });
  }
  // Decision 0024: a card bill until the payments into the card clear it.
  for (const { account, status } of cards) {
    items.push({
      date: status.daysLeft! < 0 ? start : addDays(start, status.daysLeft!),
      overdue: status.daysLeft! < 0,
      title: `${account.name} bill`,
      amount: status.remaining,
      currency: (account.currency as CurrencyCode) ?? DEFAULT_CURRENCY,
      incoming: false,
      href: `/account/${account.id}`,
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.overdue) - Number(a.overdue));
  return { days, items };
}
