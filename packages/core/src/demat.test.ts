import { describe, expect, it } from 'vitest';
import { brokerHolds, brokerOf, costFromAverage, dematGroups, marketValue, npsKey, npsMatch, securityKind, shortBrokerName } from './demat';
import { paise } from './money';

describe('securityKind', () => {
  it('tells gold bonds, ETFs, bonds and shares apart', () => {
    expect(securityKind('SGB 2030 SERIES I', 'bond')).toBe('gold_bond');
    expect(securityKind('SOVEREIGN GOLD BOND 2.50% 2031', 'equity')).toBe('gold_bond');
    expect(securityKind('NIPPON INDIA ETF NIFTY BEES', 'equity')).toBe('etf');
    expect(securityKind('GOLDBEES', 'equity')).toBe('etf');
    expect(securityKind('7.26% GOI 2033', 'bond')).toBe('bond');
    expect(securityKind('INFOSYS LIMITED', 'equity')).toBe('share');
  });
});

describe('brokers', () => {
  it('finds the broker from a bank payee and matches it to a demat account', () => {
    expect(brokerOf('ZERODHA BROKING LTD')).toBe('zerodha');
    expect(brokerOf('NEXTBILLION TECHNOLOGY')).toBe('groww');
    expect(brokerOf('Swiggy')).toBeNull();
    expect(brokerHolds('zerodha', 'ZERODHA BROKING LIMITED')).toBe(true);
    expect(brokerHolds('groww', 'ZERODHA BROKING LIMITED')).toBe(false);
  });

  it('shortens a depository participant name', () => {
    expect(shortBrokerName('ZERODHA BROKING LIMITED')).toBe('Zerodha');
    expect(shortBrokerName('ICICI SECURITIES LIMITED')).toBe('ICICI');
    expect(shortBrokerName(null)).toBe('Demat');
  });
});

describe('npsKey', () => {
  it('ignores case and punctuation', () => {
    expect(npsKey('SBI Pension Fund Scheme - E - Tier I')).toBe(npsKey('SBI PENSION FUND SCHEME E TIER I'));
  });
});

describe('npsMatch', () => {
  const navs = [
    'SBI PENSION FUNDS PVT. LTD. SCHEME E - TIER I',
    'SBI PENSION FUNDS PVT. LTD. SCHEME E - TIER II',
    'SBI PENSION FUNDS PVT. LTD. SCHEME C - TIER I',
    'HDFC PENSION FUND MANAGEMENT LIMITED SCHEME E - TIER I',
  ];
  it('matches by fund manager, scheme and tier when the names differ', () => {
    expect(npsMatch('SBI PENSION FUND SCHEME E - TIER I', navs)).toBe(navs[0]);
    expect(npsMatch('SBI Pension Fund Scheme E - Tier II', navs)).toBe(navs[1]);
    expect(npsMatch('HDFC PENSION FUND SCHEME E TIER I', navs)).toBe(navs[3]);
  });
  it('gives up when nothing or several fit', () => {
    expect(npsMatch('UTI RETIREMENT SOLUTIONS SCHEME G - TIER I', navs)).toBeNull();
    expect(npsMatch('SBI PENSION FUND', navs)).toBeNull();
  });
});

describe('marketValue', () => {
  const share = { unitsE4: 100_000, statementPriceE4: 12_000_000, latestPriceE4: 13_000_000, costPaise: 1_100_000, costKnown: true };
  const unknown = { unitsE4: 10_000, statementPriceE4: 72_450_000, latestPriceE4: null, costPaise: 724_500, costKnown: false };

  it('values holdings at the latest price and counts gain only where cost is known', () => {
    const result = marketValue([share, unknown], paise(1_100_000 + 724_500));
    expect(result.values).toEqual([1_300_000, 724_500]);
    expect(result.value).toBe(2_024_500);
    expect(result.gain).toBe(200_000);
    expect(result.invested).toBe(1_100_000);
    expect(result.missingCost).toBe(1);
  });

  it('adds money moved in since the statement as it is', () => {
    expect(marketValue([share], paise(1_100_000 + 50_000)).value).toBe(1_350_000);
  });

  it('has no gain when no cost is known', () => {
    expect(marketValue([unknown], paise(724_500)).gain).toBeNull();
  });
});

describe('costFromAverage', () => {
  it('multiplies units by the average price', () => {
    expect(costFromAverage(100_000, 11_005_000)).toBe(1_100_500);
  });
});

describe('dematGroups', () => {
  const statement = {
    kind: 'demat' as const,
    statement: { from: '01-Oct-2026', to: '31-Oct-2026' },
    file_type: 'CDSL',
    warnings: [],
    accounts: [
      {
        depository: 'CDSL',
        dp: 'ZERODHA BROKING LIMITED',
        client: '3456',
        equities: [
          { name: 'INFOSYS LIMITED', isin: 'INE009A01021', symbol: 'INFY', units: '10', price: '1500.25', value: '15002.50' },
          { name: 'NIPPON INDIA ETF GOLD BEES', isin: 'INF204KB17I5', symbol: 'GOLDBEES', units: '100', price: '60', value: '6000' },
          { name: 'SOLD LTD', isin: 'INE000Z01010', units: '0', price: '10', value: '0' },
        ],
        bonds: [{ name: 'SGB 2030 SERIES I', isin: 'IN0020230001', units: '1', price: '7245', value: '7245' }],
        funds: [
          { name: 'Held Fund', isin: 'INF000000001', amfi: '100001', units: '5', price: '100', value: '500', cost: '450' },
          { name: 'Demat Fund', isin: 'INF000000002', amfi: '100002', units: '1.5', price: '2000', value: '3000', cost: '2900' },
        ],
      },
    ],
    nps: { pran: '1234', schemes: [{ name: 'SBI PENSION FUND SCHEME E - TIER I', manager: 'SBI', tier: 'I', units: '1000.1234', price: '50', value: '50006.17' }] },
  };

  it('makes one Stocks account per demat account and one NPS account', () => {
    const groups = dematGroups(statement, new Set(['INF000000001']));
    expect(groups.map((g) => [g.type, g.name, g.last4, g.asOf])).toEqual([
      ['stock', 'Zerodha demat', '3456', '2026-10-31'],
      ['nps', 'NPS', '1234', '2026-10-31'],
    ]);
    expect(groups[0]!.items.map((i) => [i.kind, i.symbol ?? i.name, i.unitsE4, i.value, i.cost])).toEqual([
      ['share', 'INFY', 100_000, 1_500_250, null],
      ['etf', 'GOLDBEES', 1_000_000, 600_000, null],
      ['gold_bond', 'SGB 2030 SERIES I', 10_000, 724_500, null],
      ['fund', 'Demat Fund', 15_000, 300_000, 290_000],
    ]);
    expect(groups[1]!.items[0]).toMatchObject({ kind: 'nps', unitsE4: 10_001_234, priceE4: 500_000 });
  });
});
