import { describe, expect, it } from 'vitest';
import { casHoldings, holdingValue, shortSchemeName, sipFundFor, type HoldingRow } from './fund-views';
import { fundValue, type CasScheme, type CasStatement } from './fund';
import { paise } from './money';

function scheme(overrides: Partial<CasScheme> = {}): CasScheme {
  return {
    name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth',
    isin: 'INF879O01027',
    amfi: '122639',
    rta: 'CAMS',
    type: 'EQUITY',
    units: '100.5000',
    valuation: { date: '2026-10-31', nav: '80.0000', cost: '7000.00', value: '8040.00' },
    transactions: [],
    ...overrides,
  };
}

function statement(schemes: CasScheme[], to: string | null = '2026-10-31'): CasStatement {
  return { statement: { from: null, to }, cas_type: null, file_type: null, warnings: [], folios: [{ folio: '1234567/89', amc: 'PPFAS Mutual Fund', schemes }] };
}

describe('casHoldings', () => {
  it('reads units, cost, value and NAV as integers', () => {
    const [h] = casHoldings(statement([scheme()]));
    expect(h).toMatchObject({
      key: 'INF879O01027:1234567/89',
      isin: 'INF879O01027',
      amfiCode: '122639',
      unitsE4: 1_005_000,
      cost: 700_000,
      value: 804_000,
      navE4: 800_000,
      navDate: '2026-10-31',
      asOf: '2026-10-31',
      sip: null,
    });
  });

  it('leaves out closed folios and nameless schemes', () => {
    expect(casHoldings(statement([scheme({ units: '0.000' }), scheme({ name: null })]))).toEqual([]);
  });

  it('drops malformed codes and works out a missing value from the NAV', () => {
    const [h] = casHoldings(statement([scheme({ isin: 'bad', amfi: 'x1', valuation: { date: null, nav: '80.0000', cost: '7000', value: null } })]));
    expect(h).toMatchObject({ isin: null, amfiCode: null, value: 804_000, asOf: '2026-10-31' });
  });

  it('falls back to the cost of the units from the transactions, then to the value', () => {
    const bought = [{ date: '2026-01-05', type: 'PURCHASE', amount: '7500.00', units: '100.5000', nav: '74.6269' }];
    const [fromTx] = casHoldings(statement([scheme({ valuation: { date: '2026-10-31', nav: '80', cost: null, value: '8040' }, transactions: bought })]));
    expect(fromTx!.cost).toBe(750_000);
    const [fromValue] = casHoldings(statement([scheme({ valuation: { date: '2026-10-31', nav: '80', cost: null, value: '8040' } })]));
    expect(fromValue!.cost).toBe(804_000);
  });

  it('uses today when the statement has no dates at all', () => {
    const [h] = casHoldings(statement([scheme({ valuation: { date: null, nav: null, cost: '1', value: '1' } })], null), '2026-11-08');
    expect(h).toMatchObject({ asOf: '2026-11-08', navE4: null, navDate: null });
  });
});

describe('shortSchemeName', () => {
  it('keeps the fund name and drops plan and option', () => {
    expect(shortSchemeName('Parag Parikh Flexi Cap Fund - Direct Plan - Growth')).toBe('Parag Parikh Flexi Cap Fund');
    expect(shortSchemeName('HDFC Index Fund (formerly HDFC Index Sensex) - Direct')).toBe('HDFC Index Fund');
  });
});

const holding = (overrides: Partial<HoldingRow> = {}): HoldingRow => ({
  accountId: 'fund',
  amfiCode: '122639',
  isin: 'INF879O01027',
  unitsE4: 1_000_000, // 100 units
  costPaise: 700_000,
  navE4: 800_000, // ₹80
  navDate: '2026-10-31',
  asOf: '2026-10-31',
  amc: 'PPFAS Mutual Fund',
  sipPaise: 500_000,
  sipDay: 5,
  ...overrides,
});

describe('holdingValue', () => {
  it('values the units at the statement NAV when nothing newer is known', () => {
    expect(holdingValue(holding(), new Map(), [], paise(700_000))).toEqual({ value: 800_000, gain: 100_000, navE4: 800_000, navDate: '2026-10-31', estimatedUnitsE4: 0 });
  });

  it('prefers a newer AMFI NAV, by code or ISIN, but not an older one', () => {
    const newer = new Map([['INF879O01027', { navE4: 900_000, date: '2026-11-07' }]]);
    expect(holdingValue(holding(), newer, [], paise(700_000))).toMatchObject({ value: 900_000, navE4: 900_000, navDate: '2026-11-07' });
    const older = new Map([['122639', { navE4: 600_000, date: '2026-10-01' }]]);
    expect(holdingValue(holding(), older, [], paise(700_000)).navE4).toBe(800_000);
  });

  it('turns a SIP paid in after the statement into units', () => {
    const latest = new Map([['122639', { navE4: 1_000_000, date: '2026-11-07' }]]);
    // ₹5,000 on 5 Nov buys about 50 units at the NAV estimated for that day.
    const v = holdingValue(holding(), latest, [{ on: '2026-11-05', amount: paise(500_000) }], paise(1_200_000));
    // Between the units ₹80 and ₹100 would buy (62.5 and 50).
    expect(v.estimatedUnitsE4).toBeGreaterThanOrEqual(500_000);
    expect(v.estimatedUnitsE4).toBeLessThanOrEqual(625_000);
    expect(v.value).toBe(fundValue(1_000_000 + v.estimatedUnitsE4, 1_000_000));
    expect(v.gain).toBe(v.value - 700_000 - 500_000);
  });

  it('ignores flows on or before the statement, and counts money taken out as it is', () => {
    const v = holdingValue(holding(), new Map(), [{ on: '2026-10-31', amount: paise(500_000) }, { on: '2026-11-02', amount: paise(-100_000) }], paise(600_000));
    expect(v).toMatchObject({ estimatedUnitsE4: 0, value: 700_000, gain: 100_000 });
  });

  it('falls back to cost plus money in when there is no NAV at all', () => {
    const v = holdingValue(holding({ navE4: null, navDate: null }), new Map(), [], undefined);
    expect(v).toMatchObject({ value: 700_000, gain: 0, navE4: null });
  });
});

describe('sipFundFor', () => {
  const a = holding({ accountId: 'a', sipDay: 5 });
  const b = holding({ accountId: 'b', sipDay: 28 });
  const debit = (on: string, amount = 500_000, payee: string | null = 'PPFAS MF') => ({ on, amount: paise(amount), payee });

  it('picks the fund whose SIP day is nearest, across month ends', () => {
    expect(sipFundFor([a, b], debit('2026-11-06'), new Set())?.accountId).toBe('a');
    expect(sipFundFor([a, b], debit('2026-11-30'), new Set())?.accountId).toBe('b');
    const c = holding({ accountId: 'c', sipDay: 30 });
    expect(sipFundFor([a, c], debit('2026-12-01'), new Set())?.accountId).toBe('c');
  });

  it('allows a rupee of rounding and nothing more', () => {
    expect(sipFundFor([a], debit('2026-11-05', 500_100), new Set())).not.toBeNull();
    expect(sipFundFor([a], debit('2026-11-05', 500_101), new Set())).toBeNull();
  });

  it('needs a fund payee, a date after the statement, and no money that month yet', () => {
    expect(sipFundFor([a], debit('2026-11-05', 500_000, 'SWIGGY'), new Set())).toBeNull();
    expect(sipFundFor([a], debit('2026-10-30'), new Set())).toBeNull();
    expect(sipFundFor([a, b], debit('2026-11-05'), new Set(['a|2026-11']))?.accountId).toBe('b');
  });

  it('skips holdings with no SIP', () => {
    expect(sipFundFor([holding({ sipPaise: null })], debit('2026-11-05'), new Set())).toBeNull();
  });
});
