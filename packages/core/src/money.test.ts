import { describe, expect, it } from 'vitest';
import { formatRupees, paise, parseRupees } from './money';

describe('parseRupees', () => {
  it.each([
    ['450', 45000],
    ['Rs. 450', 45000],
    ['Rs.450.00', 45000],
    ['INR 2,000.5', 200050],
    ['₹99', 9900],
    ['1,23,456.78', 12345678],
    ['0.07', 7],
    ['-10.10', -1010],
  ])('parses %s', (text, expected) => {
    expect(parseRupees(text)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '12..5', 'Rs.', '1e5'])('rejects %s', (text) => {
    expect(parseRupees(text)).toBeNull();
  });

  it('never uses floating point', () => {
    // 0.1 + 0.2 style errors would show up here.
    expect(parseRupees('0.29')).toBe(29);
    expect(parseRupees('1.15')).toBe(115);
  });
});

describe('formatRupees', () => {
  it.each([
    [0, '₹0.00'],
    [5, '₹0.05'],
    [45000, '₹450.00'],
    [100000, '₹1,000.00'],
    [12345678, '₹1,23,456.78'],
    [1000000000, '₹1,00,00,000.00'],
    [-200050, '-₹2,000.50'],
  ])('formats %i', (value, expected) => {
    expect(formatRupees(paise(value))).toBe(expected);
  });

  it('can omit the symbol', () => {
    expect(formatRupees(paise(12345678), { symbol: false })).toBe('1,23,456.78');
  });
});

describe('paise', () => {
  it('rejects fractions', () => {
    expect(() => paise(1.5)).toThrow(RangeError);
  });
});
