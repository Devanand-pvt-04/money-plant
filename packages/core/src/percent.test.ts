import { describe, expect, it } from 'vitest';
import { percentLabel, wholePercents } from './percent';

describe('wholePercents', () => {
  it('adds up to 100 where plain rounding would not', () => {
    // The Accounts card from the bug report, in rupees: funds, bank, deposits, cash + lent.
    const values = [41138, 93904, 136326, 1321 + 10568];
    const percents = wholePercents(values);
    expect(percents).toEqual([15, 33, 48, 4]);
    expect(percents.reduce((s, p) => s + p, 0)).toBe(100);
  });

  it('gives thirds 34, 33, 33', () => {
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('leaves zero and negative values out', () => {
    expect(wholePercents([0, 50, -20, 50])).toEqual([0, 50, 0, 50]);
    expect(wholePercents([0, 0])).toEqual([0, 0]);
  });

  it('keeps a tiny share at 0 rather than taking from bigger ones', () => {
    expect(wholePercents([1, 99_999])).toEqual([0, 100]);
  });
});

describe('percentLabel', () => {
  it('says <1% for a share that rounds to nothing', () => {
    expect(percentLabel(5, 0)).toBe('<1%');
    expect(percentLabel(0, 0)).toBe('0%');
    expect(percentLabel(10, 12)).toBe('12%');
  });
});
