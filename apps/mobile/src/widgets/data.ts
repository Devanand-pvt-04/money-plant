import type { Paise, PaceStatus } from '@money-plant/core';
import { currentMonth, daysLeft, incomeThisMonth, monthOverview } from '@/lib/budgets';
import { applyHomeCurrency } from '@/lib/home-currency';
import { countPending } from '@/lib/ledger';
import { storedSession } from '@/lib/session';
import { weekAhead, type DueItem } from '@/lib/week';
import { widgetAmountsShown } from '@/lib/widget-settings';

/**
 * What the widgets show (decision 0036), worked out from the phone's database
 * with the same functions as Home. Runs in the widget's headless task too,
 * where the app hasn't started: the session and home currency are read here.
 */

export interface MonthWidgetData {
  month: string;
  spent: Paise;
  /** The month's total budget, or null with no budgets set. */
  limit: Paise | null;
  income: Paise;
  status: PaceStatus;
  /** Share of the month gone, 0 to 1, for the pace marker. */
  elapsed: number;
  daysLeft: number;
}

export interface ComingUpWidgetData {
  items: DueItem[];
}

export interface QuickAddWidgetData {
  pending: number;
}

export interface WidgetContext {
  /** Settings → App → Show amounts on widgets. */
  amounts: boolean;
}

/** The context for drawing, or null when nobody is signed in on this phone (or the database won't open). */
export async function widgetContext(): Promise<WidgetContext | null> {
  try {
    const session = await storedSession();
    if (!session) return null;
    applyHomeCurrency(session.user.user_metadata);
    return { amounts: await widgetAmountsShown() };
  } catch {
    return null;
  }
}

export async function monthWidgetData(): Promise<MonthWidgetData> {
  const month = currentMonth();
  const [overview, income] = await Promise.all([monthOverview(month), incomeThisMonth(month)]);
  const line = overview.overall;
  return {
    month,
    spent: line.spent,
    limit: line.limit,
    income,
    status: line.pace?.status ?? 'ok',
    elapsed: overview.elapsed,
    daysLeft: daysLeft(month) ?? 0,
  };
}

export async function quickAddWidgetData(): Promise<QuickAddWidgetData> {
  return { pending: await countPending() };
}

export async function comingUpWidgetData(): Promise<ComingUpWidgetData> {
  return { items: (await weekAhead()).items };
}
