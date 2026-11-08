import { describe, expect, it } from 'vitest';
import { convert, convertOn, CURRENCIES, formatMoney, isCurrency, parseMoney, rateFromDecimal, rateOn, RATE_SCALE } from './currency';

describe('currencies', () => {
  it('knows the decimals of each currency', () => {
    expect(CURRENCIES.get('INR')?.decimals).toBe(2);
    expect(CURRENCIES.get('AED')?.decimals).toBe(2);
    expect(CURRENCIES.get('KWD')?.decimals).toBe(3);
    expect(CURRENCIES.get('JPY')?.decimals).toBe(0);
  });

  it('gives each currency its own symbol', () => {
    const symbols = [...CURRENCIES.values()].map((info) => info.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('only accepts known codes', () => {
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('usd')).toBe(false);
    expect(isCurrency('XYZ')).toBe(false);
    expect(isCurrency(5)).toBe(false);
  });
});

describe('formatMoney', () => {
  it.each([
    [12345678, 'INR', '₹1,23,456.78'],
    [-200050, 'INR', '-₹2,000.50'],
    [5, 'INR', '₹0.05'],
    [12345678, 'USD', '$123,456.78'],
    [125000, 'AED', 'AED 1,250.00'],
    [1250500, 'KWD', 'KWD 1,250.500'],
    [7, 'KWD', 'KWD 0.007'],
    [1250000, 'JPY', '¥1,250,000'],
    [0, 'EUR', '€0.00'],
  ])('formats %i %s', (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected);
  });

  it('can leave the symbol out', () => {
    expect(formatMoney(125000, 'USD', { symbol: false })).toBe('1,250.00');
  });

  it('refuses unknown currencies and fractions', () => {
    expect(() => formatMoney(100, 'XYZ')).toThrow(RangeError);
    expect(() => formatMoney(1.5, 'USD')).toThrow(RangeError);
  });
});

describe('parseMoney', () => {
  it.each([
    ['1,250.5', 'USD', 125050],
    ['450', 'INR', 45000],
    ['-10', 'EUR', -1000],
    ['1.250', 'KWD', 1250],
    ['1250', 'JPY', 1250],
  ])('parses %s %s', (text, currency, expected) => {
    expect(parseMoney(text, currency)).toBe(expected);
  });

  it.each([
    ['1.234', 'USD'],
    ['1.5', 'JPY'],
    ['abc', 'INR'],
    ['', 'INR'],
    ['1e5', 'USD'],
  ])('rejects %s %s', (text, currency) => {
    expect(parseMoney(text, currency)).toBeNull();
  });

  it('never uses floating point', () => {
    expect(parseMoney('0.29', 'USD')).toBe(29);
    expect(parseMoney('1.15', 'USD')).toBe(115);
  });
});

describe('rateFromDecimal', () => {
  it.each([
    ['1', RATE_SCALE],
    ['0.01189', 11_890_000n],
    ['98.765', 98_765_000_000n],
    ['1e-7', 100n],
    ['1.5E2', 150_000_000_000n],
    ['0.0000000005', 0n],
  ])('reads %s', (text, expected) => {
    expect(rateFromDecimal(text)).toBe(expected === 0n ? null : expected);
  });

  it('rejects junk', () => {
    expect(rateFromDecimal('abc')).toBeNull();
    expect(rateFromDecimal('-1')).toBeNull();
    expect(rateFromDecimal('0')).toBeNull();
  });
});

describe('convert', () => {
  // About ₹84 to the dollar, ₹23 to the dirham, ₹272 to the Kuwaiti dinar, ₹0.56 to the yen.
  const INR = RATE_SCALE;
  const USD = 11_904_762n; // 1 / 84
  const AED = 43_478_261n; // 1 / 23
  const KWD = 3_676_471n; // 1 / 272
  const JPY = 1_785_714_286n; // 1 / 0.56

  it('leaves an amount in its own currency alone', () => {
    expect(convert(12345, 'USD', 'USD', { from: USD, to: USD })).toBe(12345);
  });

  it('converts between rupees and dollars', () => {
    expect(convert(2500, 'USD', 'INR', { from: USD, to: INR })).toBe(210000); // $25.00 -> ₹2,100.00
    expect(convert(8400000, 'INR', 'USD', { from: INR, to: USD })).toBe(100000); // ₹84,000 -> $1,000.00
  });

  it('handles currencies with 0 and 3 decimals', () => {
    expect(convert(1000, 'JPY', 'INR', { from: JPY, to: INR })).toBe(56000); // ¥1,000 -> ₹560.00
    expect(convert(1000, 'KWD', 'INR', { from: KWD, to: INR })).toBe(27200); // KWD 1.000 -> ₹272.00
    expect(convert(27200, 'INR', 'KWD', { from: INR, to: KWD })).toBe(1000);
  });

  it('converts between two foreign currencies through the rupee', () => {
    // $1 = ₹84 = AED 3.65
    expect(convert(10000, 'USD', 'AED', { from: USD, to: AED })).toBe(36522);
  });

  it('rounds halves to even, and keeps the sign', () => {
    const half = RATE_SCALE * 2n; // 1 rupee buys 2 units, so ₹0.01 is 0.02 units: no rounding
    expect(convert(1, 'INR', 'USD', { from: INR, to: half })).toBe(2);
    // ₹0.05 at 0.5 units per rupee is 2.5 cents -> 2; ₹0.07 -> 3.5 -> 4.
    const halfRate = RATE_SCALE / 2n;
    expect(convert(5, 'INR', 'USD', { from: INR, to: halfRate })).toBe(2);
    expect(convert(7, 'INR', 'USD', { from: INR, to: halfRate })).toBe(4);
    expect(convert(-7, 'INR', 'USD', { from: INR, to: halfRate })).toBe(-4);
  });

  it('refuses bad input', () => {
    expect(() => convert(1.5, 'USD', 'INR', { from: USD, to: INR })).toThrow(RangeError);
    expect(() => convert(100, 'USD', 'INR', { from: 0n, to: INR })).toThrow(RangeError);
  });
});

describe('rateOn and convertOn', () => {
  const rows = [
    { date: '2026-11-06', currency: 'USD', perInrE9: 11_904_762n },
    { date: '2026-11-07', currency: 'USD', perInrE9: 11_800_000n },
    { date: '2026-11-07', currency: 'AED', perInrE9: 43_478_261n },
  ];

  it('uses the day itself, or the nearest earlier day', () => {
    expect(rateOn(rows, 'USD', '2026-11-07')).toBe(11_800_000n);
    expect(rateOn(rows, 'USD', '2026-11-09')).toBe(11_800_000n); // Sunday: Friday's rate
    expect(rateOn(rows, 'USD', '2026-11-06')).toBe(11_904_762n);
    expect(rateOn(rows, 'USD', '2026-11-01')).toBeNull();
    expect(rateOn(rows, 'GBP', '2026-11-07')).toBeNull();
  });

  it('always knows the rupee', () => {
    expect(rateOn([], 'INR', '2020-01-01')).toBe(RATE_SCALE);
  });

  it('converts on a day, or says it cannot', () => {
    expect(convertOn(rows, 2500, 'USD', 'INR', '2026-11-06')).toBe(210000);
    expect(convertOn(rows, 2500, 'USD', 'USD', '2020-01-01')).toBe(2500);
    expect(convertOn(rows, 2500, 'USD', 'INR', '2026-01-01')).toBeNull();
  });
});
