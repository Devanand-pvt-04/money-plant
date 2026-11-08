import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { minorDecimal, rupeesDecimal, toCsv } from './csv';

describe('toCsv', () => {
  it('writes a header and rows with CRLF line ends', () => {
    expect(toCsv(['a', 'b'], [[1, 'x'], [null, undefined]])).toBe('a,b\r\n1,x\r\n,\r\n');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(toCsv(['note'], [['Lunch, dinner'], ['He said "hi"'], ['two\nlines']])).toBe(
      'note\r\n"Lunch, dinner"\r\n"He said ""hi"""\r\n"two\nlines"\r\n',
    );
  });

  it('defuses text a spreadsheet would run as a formula', () => {
    expect(toCsv(['payee'], [['=HYPERLINK("x")'], ['+91 shop'], ['@home']])).toBe("payee\r\n\"'=HYPERLINK(\"\"x\"\")\"\r\n'+91 shop\r\n'@home\r\n");
  });

  it('leaves negative numbers alone', () => {
    expect(toCsv(['amount'], [[-450]])).toBe('amount\r\n-450\r\n');
  });
});

describe('rupeesDecimal', () => {
  it.each([
    [0, '0.00'],
    [7, '0.07'],
    [45000, '450.00'],
    [12345678, '123456.78'],
    [-1010, '-10.10'],
  ])('formats %i paise', (value, expected) => {
    expect(rupeesDecimal(paise(value))).toBe(expected);
  });
});

describe('minorDecimal', () => {
  it('writes each currency with its own decimals (decision 0017)', () => {
    expect(minorDecimal(-123456, 'USD')).toBe('-1234.56');
    expect(minorDecimal(2500, 'JPY')).toBe('2500');
    expect(minorDecimal(3250, 'KWD')).toBe('3.250');
    expect(minorDecimal(5, 'INR')).toBe('0.05');
  });
});
