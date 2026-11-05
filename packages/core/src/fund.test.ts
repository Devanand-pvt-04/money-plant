import { describe, expect, it } from 'vitest';
import { casDate, casFlows, costFromTransactions, detectSip, fundChart, fundValue, isFundPayee, lastWorkingDay, matchesFlow, monthEnd, navOn, pairFlows, rupeesToPaise, scaleDecimal, unitsBought, type CasTransaction } from './fund';
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

describe('units bought after the statement (NW-3)', () => {
  it('divides the amount by the NAV, to 4 decimals', () => {
    // ₹2,500 at ₹81.2345 buys 30.7751 units.
    expect(unitsBought(paise(250_000), 812_345)).toBe(307_751);
    expect(unitsBought(paise(0), 812_345)).toBe(0);
  });

  it('estimates the NAV on a date between the statement and today', () => {
    const statement = { navE4: 800_000, date: '2026-10-01' };
    const latest = { navE4: 830_000, date: '2026-10-31' };
    expect(navOn('2026-10-16', statement, latest)).toBe(815_000);
    expect(navOn('2026-11-02', statement, latest)).toBe(830_000);
    expect(navOn('2026-09-20', statement, latest)).toBe(800_000);
    expect(navOn('2026-10-16', null, latest)).toBe(830_000);
    expect(navOn('2026-10-16', statement, null)).toBe(800_000);
  });
});

describe('costFromTransactions', () => {
  const t = (date: string, type: string, amount: string | null, units: string | null) => tx(date, type, amount, units);
  it('adds purchases and their stamp duty when the statement prints no cost', () => {
    const history = [
      t('2026-08-15', 'PURCHASE_SIP', '2499.88', '50.000'),
      t('2026-08-15', 'STAMP_DUTY_TAX', '0.12', null),
      t('2026-09-15', 'PURCHASE_SIP', '2499.88', '52.500'),
      t('2026-09-15', 'STAMP_DUTY_TAX', '0.12', null),
      t('2026-10-15', 'PURCHASE_SIP', '2499.88', '49.000'),
      t('2026-10-15', 'STAMP_DUTY_TAX', '0.12', null),
    ];
    expect(costFromTransactions(history, 1_515_000)).toBe(750_000);
  });
  it('uses the oldest units up first on a redemption', () => {
    const history = [t('2026-01-01', 'PURCHASE', '1000', '100'), t('2026-02-01', 'PURCHASE', '1200', '100'), t('2026-03-01', 'REDEMPTION', '-1500', '-150')];
    // 50 units left from the second lot: half of ₹1,200.
    expect(costFromTransactions(history, 500_000)).toBe(60_000);
  });
  it('gives up when the statement starts after the first purchase', () => {
    expect(costFromTransactions([t('2026-10-15', 'PURCHASE_SIP', '2500', '49')], 1_515_000)).toBeNull();
  });
});

describe('fund chart', () => {
  const t = (date: string, type: string, amount: string, units: string): CasTransaction => ({ date, type, amount, units, nav: null });
  const transactions = [
    t('2026-08-10', 'PURCHASE_SIP', '5000', '100.0000'),
    t('2026-09-10', 'PURCHASE_SIP', '5000', '90.0000'),
    t('2026-10-10', 'PURCHASE_SIP', '5000', '80.0000'),
  ];
  const base = {
    transactions,
    unitsE4: 2_700_000,
    cost: paise(1_500_000),
    asOf: '2026-10-31',
    paidSince: [{ on: '2026-11-10', amount: paise(500_000) }],
    statementNav: { navE4: 650_000, date: '2026-10-31' },
    latestNav: { navE4: 650_000, date: '2026-11-20' },
  } as const;

  it('works back from the statement and forward with the SIPs since', () => {
    const points = fundChart({
      ...base,
      months: [
        { month: '2026-07', navE4: 500_000 },
        { month: '2026-08', navE4: 550_000 },
        { month: '2026-09', navE4: 600_000 },
        { month: '2026-10', navE4: 650_000 },
        { month: '2026-11', navE4: 700_000 },
      ],
    });
    // July: nothing held yet.
    expect(points.map((p) => p.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(points[0]).toEqual({ month: '2026-08', value: fundValue(1_000_000, 550_000), invested: 500_000 });
    expect(points[1]).toEqual({ month: '2026-09', value: fundValue(1_900_000, 600_000), invested: 1_000_000 });
    expect(points[2]).toEqual({ month: '2026-10', value: fundValue(2_700_000, 650_000), invested: 1_500_000 });
    // November: 5000 at an estimated 65.00 buys 76.9231 units.
    expect(points[3]).toEqual({ month: '2026-11', value: fundValue(2_700_000 + unitsBought(paise(500_000), 650_000), 700_000), invested: 2_000_000 });
  });

  it('falls back to the cost less later purchases when the statement starts late, and skips months with no NAV', () => {
    const points = fundChart({
      ...base,
      unitsE4: 3_700_000,
      cost: paise(2_000_000),
      months: [
        { month: '2026-07', navE4: 500_000 },
        { month: '2026-08', navE4: null },
      ],
    });
    expect(points).toEqual([{ month: '2026-07', value: fundValue(1_000_000, 500_000), invested: 500_000 }]);
  });

  it('finds month ends and their last weekday', () => {
    expect(monthEnd('2026-02')).toBe('2026-02-28');
    expect(monthEnd('2028-02')).toBe('2028-02-29');
    // 31 Jan 2027 is a Sunday.
    expect(lastWorkingDay('2027-01')).toBe('2027-01-29');
    expect(lastWorkingDay('2026-10')).toBe('2026-10-30');
  });
});
