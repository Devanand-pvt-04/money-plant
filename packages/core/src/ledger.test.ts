import { describe, expect, it } from 'vitest';
import { balanceOf, isAccountType, validatePostings } from './ledger';
import { paise } from './money';

const post = (accountId: string, amount: number) => ({ accountId, amount: paise(amount) });

describe('validatePostings', () => {
  it('accepts a balanced pair', () => {
    expect(validatePostings([post('hdfc', -45000), post('food', 45000)])).toBeNull();
  });

  it('accepts a balanced split', () => {
    expect(
      validatePostings([post('hdfc', -100000), post('food', 60000), post('ravi', 40000)]),
    ).toBeNull();
  });

  it('rejects a single posting', () => {
    expect(validatePostings([post('hdfc', 0)])).toEqual({ code: 'too_few_postings' });
  });

  it('rejects an unbalanced transaction', () => {
    expect(validatePostings([post('hdfc', -45000), post('food', 40000)])).toEqual({
      code: 'unbalanced',
      sum: -5000,
    });
  });

  it('rejects zero amounts', () => {
    expect(validatePostings([post('hdfc', 0), post('food', 0)])).toEqual({
      code: 'zero_amount',
      index: 0,
    });
  });
});

describe('balanceOf', () => {
  it('adds postings to the opening balance', () => {
    const postings = [post('hdfc', -45000), post('food', 45000), post('hdfc', 200000)];
    expect(balanceOf('hdfc', paise(1000000), postings)).toBe(1155000);
    expect(balanceOf('food', paise(0), postings)).toBe(45000);
  });
});

describe('isAccountType', () => {
  it('narrows known types', () => {
    expect(isAccountType('bank')).toBe(true);
    expect(isAccountType('savings')).toBe(false);
  });
});
