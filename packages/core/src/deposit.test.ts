import { describe, expect, it } from 'vitest';
import { paise } from './money';
import {
  instalmentDates,
  interestOn,
  isDepositPayment,
  isMaturityCredit,
  maturityValue,
  paidIn,
  payoutAmount,
  valueOn,
  type DepositTerms,
} from './deposit';

const r = (rupees: number) => paise(Math.round(rupees * 100));
const fd: DepositTerms = { kind: 'fd', amount: r(100_000), rateBp: 700, startDate: '2026-01-01', maturityDate: '2027-01-01', payout: 'reinvest' };
const rd: DepositTerms = { kind: 'rd', amount: r(12_000), rateBp: 750, startDate: '2026-04-01', maturityDate: '2027-04-01', payout: 'reinvest' };

describe('FD', () => {
  it('compounds quarterly: 7% for a year gives about 7.19%', () => {
    expect(maturityValue(fd)).toBe(r(107_185.9));
  });

  it('earns interest as days pass, and stops at maturity', () => {
    expect(valueOn(fd, '2025-12-31')).toBe(0);
    expect(valueOn(fd, '2026-01-01')).toBe(r(100_000));
    expect(interestOn(fd, '2026-07-02')).toBeGreaterThan(r(3_500));
    expect(interestOn(fd, '2026-07-02')).toBeLessThan(r(3_600));
    expect(valueOn(fd, '2030-01-01')).toBe(maturityValue(fd));
  });

  it('stays at its principal when it pays the interest out', () => {
    const monthly = { ...fd, payout: 'monthly' as const };
    expect(valueOn(monthly, '2026-06-01')).toBe(r(100_000));
    expect(payoutAmount(monthly)).toBe(r(583.33));
    expect(payoutAmount({ ...fd, payout: 'quarterly' })).toBe(r(1_750));
    expect(payoutAmount(fd)).toBeNull();
  });
});

describe('RD', () => {
  it('has one instalment a month until maturity', () => {
    const dates = instalmentDates(rd);
    expect(dates).toHaveLength(12);
    expect(dates[0]).toBe('2026-04-01');
    expect(dates[11]).toBe('2027-03-01');
  });

  it('counts instalments due so far', () => {
    expect(paidIn(rd, '2026-10-25')).toBe(r(84_000));
  });

  it('matures near the bank figure for ₹12,000 a month at 7.5% for a year', () => {
    // The banks' formula, the sum of R × (1 + r/4)^(n/3) over the months left, gives ₹1,49,892.
    const value = maturityValue(rd);
    expect(value).toBeGreaterThan(r(149_700));
    expect(value).toBeLessThan(r(150_100));
    expect(value % 1).toBe(0);
  });
});

describe('matching', () => {
  const debit = (amount: number, on: string, counterparty: string | null) => ({ amount: r(amount), on, counterparty });

  it('takes an instalment to the payee near a due date', () => {
    expect(isDepositPayment(rd, 'SHIVALIK', debit(12_000, '2026-10-01', 'SHIVALIK SMALL'))).toBe(true);
    expect(isDepositPayment(rd, 'SHIVALIK', debit(12_000, '2026-10-03', 'shivalik small'))).toBe(true);
  });

  it('rejects another amount, another payee, or a date far from any due date', () => {
    expect(isDepositPayment(rd, 'SHIVALIK', debit(12_500, '2026-10-01', 'SHIVALIK SMALL'))).toBe(false);
    expect(isDepositPayment(rd, 'SHIVALIK', debit(12_000, '2026-10-01', 'RENTOK'))).toBe(false);
    expect(isDepositPayment(rd, 'SHIVALIK', debit(12_000, '2026-10-15', 'SHIVALIK SMALL'))).toBe(false);
    expect(isDepositPayment(rd, 'SHIVALIK', debit(12_000, '2027-04-01', 'SHIVALIK SMALL'))).toBe(false);
  });

  it('takes the FD principal near its start date, with any payee when none is set', () => {
    expect(isDepositPayment(fd, null, debit(100_000, '2025-12-30', 'FD BOOKING'))).toBe(true);
    expect(isDepositPayment(fd, null, debit(100_000, '2026-02-01', null))).toBe(false);
  });

  it('recognises the maturity credit', () => {
    const value = maturityValue(fd) / 100;
    expect(isMaturityCredit(fd, debit(value, '2027-01-01', null))).toBe(true);
    expect(isMaturityCredit(fd, debit(value - 500, '2027-01-05', null))).toBe(true);
    expect(isMaturityCredit(fd, debit(value, '2026-12-20', null))).toBe(false);
    expect(isMaturityCredit(fd, debit(50_000, '2027-01-01', null))).toBe(false);
  });
});
