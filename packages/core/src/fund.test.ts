import { describe, expect, it } from 'vitest';
import { casDate, casFlows, detectSip, fundValue, isFundPayee, matchesFlow, pairFlows, rupeesToPaise, scaleDecimal, type CasTransaction } from './fund';
import { paise } from './money';

const tx = (date: string, type: string, amount: string | null, units: string | null = null): CasTransaction => ({ date, type, amount, units, nav: null });

describe('decimal scaling', () => {
  it('scales without floats and rounds half away from zero', () => {
    expect(scaleDecimal('123.4567', 4)).toBe(1_234_567);
    expect(scaleDecimal('123.45675', 4)).toBe(1_234_568);
    expect(scaleDecimal('-2499.885', 2)).toBe(-249_989);
    expect(scaleDecimal('7', 4)).toBe(70_000);
    expect(scaleDecimal('.5', 2)).toBe(50);
    expect(scaleDecimal('0.1', 2)).toBe(10);
    expect(scaleDecimal('abc', 2)).toBeNull();
    expect(scaleDecimal('', 2)).toBeNull();
    expect(scaleDecimal(null, 2)).toBeNull();
    expect(rupeesToPaise('2499.88')).toBe(249_988);
  });

  it('values units at a NAV to the nearest paisa', () => {
    // 123.456 units at ₹81.2345 = ₹10,028.79...
    expect(fundValue(1_234_560, 812_345)).toBe(1_002_889);
    expect(fundValue(0, 812_345)).toBe(0);
    // Large holdings stay exact: 1,00,000 units at ₹1,000.
    expect(fundValue(1_000_000_000, 10_000_000)).toBe(10_000_000_000);
  });

  it('reads both CAS date styles', () => {
    expect(casDate('2026-09-30')).toBe('2026-09-30');
    expect(casDate('01-Apr-2026')).toBe('2026-04-01');
    expect(casDate('1-Apr-2026')).toBe('2026-04-01');
    expect(casDate('April 2026')).toBeNull();
  });
});

describe('CAS cash flows', () => {
  it('adds stamp duty to purchases and takes taxes off redemptions', () => {
    const flows = casFlows([
      tx('2026-09-05', 'PURCHASE_SIP', '2499.88', '30.123'),
      tx('2026-09-05', 'STAMP_DUTY_TAX', '0.12'),
      tx('2026-09-20', 'REDEMPTION', '-10000.00', '-120.5'),
      tx('2026-09-20', 'STT_TAX', '0.10'),
      tx('2026-09-25', 'SWITCH_IN', '5000.00', '60'),
      tx('2026-09-26', 'DIVIDEND_REINVEST', '120.00', '1.4'),
      tx('2026-09-27', 'DIVIDEND_PAYOUT', '150.00'),
    ]);
    expect(flows).toEqual([
      { date: '2026-09-05', direction: 'in', amount: 250_000 },
      { date: '2026-09-20', direction: 'out', amount: 999_990 },
    ]);
  });

  it('drops a purchase reversed on the same day', () => {
    expect(casFlows([tx('2026-09-05', 'PURCHASE', '1000.00', '10'), tx('2026-09-05', 'REVERSAL', '-1000.00', '-10')])).toEqual([]);
  });

  it('finds a running SIP and its day', () => {
    const history = [
      tx('2026-08-05', 'PURCHASE_SIP', '2499.88', '30'),
      tx('2026-09-05', 'PURCHASE_SIP', '2499.88', '30'),
      tx('2026-09-05', 'STAMP_DUTY_TAX', '0.12'),
    ];
    expect(detectSip(history, '2026-09-30')).toEqual({ amount: 250_000, day: 5 });
    expect(detectSip(history, '2026-12-31')).toBeNull();
    expect(detectSip([tx('2026-09-05', 'PURCHASE', '5000', '50')], '2026-09-30')).toBeNull();
  });
});

describe('matching flows to bank entries', () => {
  it('knows fund payees and AMC names', () => {
    expect(isFundPayee('MUTUAL FUNDS NC')).toBe(true);
    expect(isFundPayee('Indian Clearing Corporation')).toBe(true);
    expect(isFundPayee('BSE LIMITED')).toBe(true);
    expect(isFundPayee('PPFAS SELF', 'PPFAS Mutual Fund')).toBe(true);
    expect(isFundPayee('Swiggy')).toBe(false);
    expect(isFundPayee(null)).toBe(false);
  });

  it('matches a debit up to a week before the allotment', () => {
    const flow = { date: '2026-09-08', direction: 'in' as const, amount: paise(250_000) };
    const debit = { id: 'a', on: '2026-09-05', amount: paise(250_000), direction: 'in' as const, counterparty: 'MUTUAL FUNDS NC' };
    expect(matchesFlow(flow, debit)).toBe(true);
    expect(matchesFlow(flow, { ...debit, on: '2026-08-30' })).toBe(false);
    expect(matchesFlow(flow, { ...debit, amount: paise(250_200) })).toBe(false);
    expect(matchesFlow(flow, { ...debit, counterparty: 'Swiggy' })).toBe(false);
    expect(matchesFlow(flow, { ...debit, direction: 'out' })).toBe(false);
  });

  it('pairs each entry once, and splits one debit that bought two schemes', () => {
    const flows = [
      { key: 'A', amc: null, date: '2026-09-05', direction: 'in' as const, amount: paise(250_000) },
      { key: 'A', amc: null, date: '2026-10-05', direction: 'in' as const, amount: paise(250_000) },
      { key: 'B', amc: null, date: '2026-09-12', direction: 'in' as const, amount: paise(100_000) },
      { key: 'C', amc: null, date: '2026-09-12', direction: 'in' as const, amount: paise(50_000) },
    ];
    const candidates = [
      { id: 'sep', on: '2026-09-05', amount: paise(250_000), direction: 'in' as const, counterparty: 'MUTUAL FUNDS NC' },
      { id: 'oct', on: '2026-10-04', amount: paise(250_000), direction: 'in' as const, counterparty: 'MUTUAL FUNDS NC' },
      { id: 'both', on: '2026-09-11', amount: paise(150_000), direction: 'in' as const, counterparty: 'BSE LIMITED' },
    ];
    expect(pairFlows(flows, candidates)).toEqual([
      { candidateId: 'sep', parts: [{ key: 'A', amount: 250_000 }] },
      { candidateId: 'oct', parts: [{ key: 'A', amount: 250_000 }] },
      { candidateId: 'both', parts: [{ key: 'B', amount: 100_000 }, { key: 'C', amount: 50_000 }] },
    ]);
  });
});
