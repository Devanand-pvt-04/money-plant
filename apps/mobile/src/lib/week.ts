import { addDays, daysBetween, type DateKey, type Paise } from '@money-plant/core';
import { isOpen, listIous } from './ious';
import { today, upcomingPayments } from './recurring';

export interface DueItem {
  /** The day it shows on: overdue items show on today. */
  date: DateKey;
  overdue: boolean;
  title: string;
  amount: Paise;
  /** Money in: someone pays the user back. */
  incoming: boolean;
  href: `/recurring/${string}` | `/iou/${string}`;
}

/** HOME-1: bills, EMIs and IOUs due in the next 7 days, today first. */
export async function weekAhead(): Promise<{ days: DateKey[]; items: DueItem[] }> {
  const start = today();
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [payments, ious] = await Promise.all([upcomingPayments(6), listIous()]);
  const items: DueItem[] = payments.map((u) => ({
    date: u.days < 0 ? start : addDays(start, u.days),
    overdue: u.overdue,
    title: u.item.name,
    amount: u.item.amount,
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
      incoming,
      href: `/iou/${view.id}`,
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.overdue) - Number(a.overdue));
  return { days, items };
}
