import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { firstWeekday, lagFromPurchase, learnNavLag, navFrom, ordersTotal, sipOrder, ORDER_STALE_DAYS } from './sip-order';
import { addDays } from './schedule';

// November 2026: the 13th is a Friday, 15th a Sunday, 16th a Monday.
describe('navFrom and firstWeekday', () => {
  it('gives the next business day for the default lag', () => {
    expect(firstWeekday(navFrom('2026-11-15', 1))).toBe('2026-11-16'); // Sunday -> Monday
    expect(firstWeekday(navFrom('2026-11-13', 1))).toBe('2026-11-16'); // Friday -> Monday
    expect(firstWeekday(navFrom('2026-11-16', 1))).toBe('2026-11-17'); // Monday -> Tuesday
  });

  it('gives the same day for lag 0, or Monday after a weekend', () => {
    expect(firstWeekday(navFrom('2026-11-16', 0))).toBe('2026-11-16');
    expect(firstWeekday(navFrom('2026-11-14', 0))).toBe('2026-11-16');
  });
});

describe('lagFromPurchase', () => {
  it('reads the lag from a weekday debit', () => {
    expect(lagFromPurchase('2026-11-16', '2026-11-16')).toBe(0);
    expect(lagFromPurchase('2026-11-16', '2026-11-17')).toBe(1);
    expect(lagFromPurchase('2026-11-13', '2026-11-16')).toBe(1);
  });

  it('learns nothing from a weekend debit or a holiday', () => {
    expect(lagFromPurchase('2026-11-15', '2026-11-16')).toBeNull();
    expect(lagFromPurchase('2026-11-16', '2026-11-18')).toBeNull();
  });
});

describe('learnNavLag', () => {
  it('pairs purchases with payments of the same amount before them and takes the majority', () => {
    const purchases = [
      { date: '2026-09-07' as const, amount: paise(500_000) },
      { date: '2026-10-06' as const, amount: paise(500_000) },
    ];
    const payments = [
      { on: '2026-09-07' as const, amount: paise(500_000) }, // Monday, same day
      { on: '2026-10-05' as const, amount: paise(500_000) }, // Monday, NAV Tuesday
      { on: '2026-10-05' as const, amount: paise(900_000) },
    ];
    // One vote each: a tie keeps the default.
    expect(learnNavLag(purchases, payments)).toBe(1);
    expect(learnNavLag(purchases.slice(0, 1), payments)).toBe(0);
  });

  it('is null when nothing pairs or only weekend debits pair', () => {
    expect(learnNavLag([{ date: '2026-11-16', amount: paise(500_000) }], [{ on: '2026-11-15', amount: paise(500_000) }])).toBeNull();
    expect(learnNavLag([{ date: '2026-11-16', amount: paise(500_000) }], [{ on: '2026-11-16', amount: paise(700_000) }])).toBeNull();
  });
});

describe('sipOrder', () => {
  const payment = { on: '2026-11-15' as const, amount: paise(500_000) };
  const statement = { navE4: 800_000, date: '2026-10-31' as const };
  const latest = { navE4: 1_000_000, date: '2026-11-13' as const };

  it('is in progress until the NAV is published', () => {
    expect(sipOrder(payment, 1, null, '2026-11-16', statement, latest)).toEqual({ ...payment, stage: 'in_progress', navDate: '2026-11-16', navE4: null, unitsE4: 0 });
  });

  it('is allotted at the published NAV, on the date it was published for', () => {
    // Monday was a holiday: Tuesday's NAV is the first after the debit.
    const order = sipOrder(payment, 1, { navE4: 1_000_000, date: '2026-11-17' }, '2026-11-18', statement, latest);
    expect(order).toMatchObject({ stage: 'allotted', navDate: '2026-11-17', navE4: 1_000_000, unitsE4: 500_000 });
  });

  it('falls back to the estimate when the NAV never arrives', () => {
    const order = sipOrder(payment, 1, null, addDays('2026-11-16', ORDER_STALE_DAYS + 1), statement, latest);
    expect(order).toMatchObject({ stage: 'estimated', navE4: 1_000_000 });
  });

  it('adds up units and pending money', () => {
    const orders = [
      sipOrder(payment, 1, null, '2026-11-16', statement, latest),
      sipOrder({ on: '2026-10-15', amount: paise(500_000) }, 1, { navE4: 1_000_000, date: '2026-10-16' }, '2026-11-16', statement, latest),
    ];
    expect(ordersTotal(orders)).toEqual({ unitsE4: 500_000, pending: 500_000 });
  });
});
