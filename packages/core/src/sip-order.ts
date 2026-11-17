// SIP orders from debit to units (NW-3, decision 0031). A SIP debit is money
// paid, but the fund house allots units only at the NAV of the day the money
// reaches it: usually the business day after the debit, so a Sunday or Friday
// debit gets Monday's NAV. Each payment into a fund after its CAS goes
// through three stages: paid (the debit), in progress (waiting for that NAV)
// and allotted (units at that NAV). Pure functions; apps/mobile/src/lib/funds.ts
// loads the NAVs and the learned day for each fund.

import { navOn, unitsBought, FLOW_TOLERANCE, type NavPoint } from './fund';
import { addDays, daysBetween, type DateKey } from './schedule';
import { paise, type Paise } from './money';

/**
 * Days after the debit the fund house counts from: 1 (the default) prices a
 * debit at the first NAV after its day, 0 at the first NAV on or after it.
 */
export type NavLag = 0 | 1;
export const DEFAULT_NAV_LAG: NavLag = 1;

/**
 * Days after the expected NAV date before an order that still has no NAV
 * falls back to the old estimate (navOn), so a missing NAV never hides a
 * payment's growth for long.
 */
export const ORDER_STALE_DAYS = 5;

function weekday(date: DateKey): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The first day whose NAV a debit on `on` can get: the debit day, or the day after. */
export function navFrom(on: DateKey, lag: NavLag): DateKey {
  return lag === 0 ? on : addDays(on, 1);
}

/** The first weekday on or after `date`: when AMFI most likely publishes the NAV. Holidays move it later. */
export function firstWeekday(date: DateKey): DateKey {
  let day = date;
  while (weekday(day) === 0 || weekday(day) === 6) day = addDays(day, 1);
  return day;
}

/**
 * What one CAS purchase says about the fund's lag: the bank debit was on
 * `debitOn`, the units were priced on `navDate`. A weekend debit fits both
 * lags and says nothing; a NAV date past both guesses (a holiday) says
 * nothing either.
 */
export function lagFromPurchase(debitOn: DateKey, navDate: DateKey): NavLag | null {
  const same = firstWeekday(navFrom(debitOn, 0));
  const next = firstWeekday(navFrom(debitOn, 1));
  if (same === next) return null;
  if (navDate === same) return 0;
  if (navDate === next) return 1;
  return null;
}

/**
 * The lag the CAS purchases point to, pairing each with a payment into the
 * fund of the same amount (within FLOW_TOLERANCE) up to 7 days before it.
 * Null when no purchase settles it; a tie keeps the default.
 */
export function learnNavLag(
  purchases: readonly { date: DateKey; amount: Paise }[],
  payments: readonly { on: DateKey; amount: Paise }[],
): NavLag | null {
  const used = new Set<number>();
  const votes = [0, 0];
  for (const purchase of purchases) {
    let best = -1;
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i]!;
      const gap = daysBetween(p.on, purchase.date);
      if (used.has(i) || gap < 0 || gap > 7 || Math.abs(p.amount - purchase.amount) > FLOW_TOLERANCE) continue;
      if (best < 0 || gap < daysBetween(payments[best]!.on, purchase.date)) best = i;
    }
    if (best < 0) continue;
    used.add(best);
    const lag = lagFromPurchase(payments[best]!.on, purchase.date);
    if (lag !== null) votes[lag]!++;
  }
  if (votes[0] === votes[1]) return votes[0] === 0 ? null : DEFAULT_NAV_LAG;
  return votes[0]! > votes[1]! ? 0 : 1;
}

export type OrderStage = 'in_progress' | 'allotted' | 'estimated';

export interface SipOrder {
  /** The day the money left the bank. */
  on: DateKey;
  amount: Paise;
  /**
   * in_progress: waiting for the NAV of `navDate`; the money counts at cost.
   * allotted: units at the NAV AMFI published for `navDate`.
   * estimated: that NAV never arrived, so units come from the NAV around the day (navOn), as before.
   */
  stage: OrderStage;
  /** The NAV's day: the real one once allotted, otherwise the expected one. */
  navDate: DateKey;
  navE4: number | null;
  unitsE4: number;
}

/**
 * One payment's order. `published` is the first NAV AMFI published on or
 * after navFrom(on, lag), if the phone has it; `statement` and `latest` feed
 * the fallback estimate.
 */
export function sipOrder(
  payment: { on: DateKey; amount: Paise },
  lag: NavLag,
  published: NavPoint | null,
  today: DateKey,
  statement: NavPoint | null,
  latest: NavPoint | null,
): SipOrder {
  if (published && published.navE4 > 0) {
    return { ...payment, stage: 'allotted', navDate: published.date, navE4: published.navE4, unitsE4: unitsBought(payment.amount, published.navE4) };
  }
  const expected = firstWeekday(navFrom(payment.on, lag));
  if (daysBetween(expected, today) > ORDER_STALE_DAYS) {
    const navE4 = navOn(expected, statement, latest);
    if (navE4 !== null) return { ...payment, stage: 'estimated', navDate: expected, navE4, unitsE4: unitsBought(payment.amount, navE4) };
  }
  return { ...payment, stage: 'in_progress', navDate: expected, navE4: null, unitsE4: 0 };
}

/** Units bought by orders that have them, and money still waiting for its NAV. */
export function ordersTotal(orders: readonly SipOrder[]): { unitsE4: number; pending: Paise } {
  let unitsE4 = 0;
  let pending = 0;
  for (const order of orders) {
    if (order.stage === 'in_progress') pending += order.amount;
    else unitsE4 += order.unitsE4;
  }
  return { unitsE4, pending: paise(pending) };
}
