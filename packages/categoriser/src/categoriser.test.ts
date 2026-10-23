import { describe, expect, it } from 'vitest';
import { paise } from '@money-plant/core';
import {
  STANDARD_CATEGORIES,
  categorise,
  categoryForKey,
  categoryPath,
  describePattern,
  localTime,
  lookupBuiltin,
  normaliseMerchant,
  parentKey,
  proposePatterns,
  ruleFromEntry,
  shareableVpa,
  type CategoriseInput,
  type Correction,
  type Rule,
  type UserCategory,
} from './index';

const categories: UserCategory[] = STANDARD_CATEGORIES.map((c) => ({
  id: `cat:${c.key}`,
  name: c.name,
  key: c.key,
  parentId: parentKey(c.key) ? `cat:${parentKey(c.key)}` : null,
}));

const base: CategoriseInput = {
  direction: 'debit',
  amount: paise(45000),
  counterparty: 'SWIGGY LIMITED',
  vpa: 'swiggy@axisbank',
  accountId: 'hdfc',
  minuteOfDay: 13 * 60,
  weekday: 3,
  payeeKind: 'business',
};

const rule = (over: Partial<Rule> & Pick<Rule, 'match' | 'categoryId'>): Rule => ({
  id: 'r1',
  status: 'active',
  autoConfirm: true,
  hits: 0,
  misses: 0,
  ...over,
});

describe('default categories', () => {
  it('is two levels deep with unique keys (CAT-1, CAT-5)', () => {
    const keys = STANDARD_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key.split('.').length).toBeLessThanOrEqual(2);
      const parent = parentKey(key);
      if (parent) expect(keys).toContain(parent);
    }
  });

  it('falls back to the parent when a sub-category is missing', () => {
    const withoutLunch = categories.filter((c) => c.key !== 'food.lunch');
    expect(categoryForKey(withoutLunch, 'food.lunch')?.id).toBe('cat:food');
    expect(categoryPath(categories, 'cat:food.lunch')).toBe('Food > Lunch');
  });
});

describe('normaliseMerchant', () => {
  it('makes variants of one merchant compare equal', () => {
    expect(normaliseMerchant('SWIGGY LIMITED')).toBe('swiggy');
    expect(normaliseMerchant('Swiggy Pvt. Ltd.')).toBe('swiggy');
    expect(normaliseMerchant('swiggy@axisbank')).toBe('swiggy');
  });
});

describe('merchant dictionary', () => {
  it('knows common Indian merchants, the specific ones first', () => {
    expect(lookupBuiltin('SWIGGY INSTAMART', null)?.key).toBe('food.groceries');
    expect(lookupBuiltin('SWIGGY', null)?.key).toBe('food.delivery');
    expect(lookupBuiltin('UBER INDIA SYSTEMS', null)?.key).toBe('transport.cab');
    expect(lookupBuiltin(null, 'netflix.upi@hdfcbank')?.key).toBe('entertainment.subscriptions');
    expect(lookupBuiltin('RAVI KUMAR', 'ravi.k@okaxis')).toBeNull();
  });
});

describe('categorise (CAT-2 order)', () => {
  it('uses the dictionary when nothing else matches', () => {
    expect(categorise(base, { rules: [], categories })).toMatchObject({
      categoryId: 'cat:food.delivery',
      reason: 'dictionary',
      autoConfirm: true,
    });
  });

  it('lets a user rule win over the dictionary', () => {
    const rules = [rule({ match: { kind: 'rule', merchant: 'swiggy' }, categoryId: 'cat:food.lunch' })];
    expect(categorise(base, { rules, categories })).toMatchObject({ categoryId: 'cat:food.lunch', reason: 'rule', ruleId: 'r1' });
  });

  it('prefers the more specific rule', () => {
    const rules = [
      rule({ id: 'kw', match: { kind: 'rule', keyword: 'swig' }, categoryId: 'cat:food' }),
      rule({ id: 'vpa', match: { kind: 'rule', vpa: 'swiggy@axisbank' }, categoryId: 'cat:food.snacks' }),
    ];
    expect(categorise(base, { rules, categories })?.ruleId).toBe('vpa');
  });

  it('ignores paused rules and rules whose category was deleted', () => {
    const rules = [
      rule({ id: 'paused', status: 'paused', match: { kind: 'rule', merchant: 'swiggy' }, categoryId: 'cat:food.lunch' }),
      rule({ id: 'gone', match: { kind: 'rule', merchant: 'swiggy' }, categoryId: 'deleted' }),
    ];
    expect(categorise(base, { rules, categories })?.reason).toBe('dictionary');
  });

  it('matches a learned pattern on a person before the people check (CAT-4, CAT-8)', () => {
    const bus: CategoriseInput = {
      ...base,
      counterparty: 'MURUGAN S',
      vpa: '9876543210@ybl',
      amount: paise(2000),
      minuteOfDay: 8 * 60 + 40,
      weekday: 2,
      payeeKind: 'person',
    };
    expect(categorise(bus, { rules: [], categories })).toBeNull();
    const rules = [
      rule({
        id: 'bus',
        autoConfirm: false,
        categoryId: 'cat:transport.bus',
        match: {
          kind: 'pattern',
          direction: 'debit',
          minAmount: paise(1500),
          maxAmount: paise(2500),
          startMinute: 8 * 60,
          endMinute: 10 * 60,
          weekdays: [1, 2, 3, 4, 5],
          accountId: 'hdfc',
          payeeKind: 'person',
        },
      }),
    ];
    expect(categorise(bus, { rules, categories })).toMatchObject({ reason: 'pattern', confidence: 0.7, autoConfirm: false });
    expect(categorise({ ...bus, weekday: 0 }, { rules, categories })).toBeNull();
    expect(categorise({ ...bus, minuteOfDay: 11 * 60 }, { rules, categories })).toBeNull();
  });

  it('uses cached AI answers, sending unsure ones to review', () => {
    const input = { ...base, counterparty: 'SRI LAKSHMI TIFFINS', vpa: null };
    const decision = categorise(input, {
      rules: [],
      categories,
      knownMerchant: (m) => (m === 'sri lakshmi tiffins' ? { key: 'food.eating_out', confidence: 0.6, source: 'ai' } : null),
    });
    expect(decision).toMatchObject({ categoryId: 'cat:food.eating_out', reason: 'ai', autoConfirm: false });
  });

  it("does not file money going out under an income category", () => {
    expect(categorise({ ...base, counterparty: 'SALARY ADVANCE', vpa: null }, { rules: [], categories })).toBeNull();
  });
});

describe('ruleFromEntry (CAT-3)', () => {
  it('builds a merchant rule, or a UPI ID rule when there is no name', () => {
    expect(ruleFromEntry({ counterparty: 'Zomato Ltd', vpa: null, direction: 'debit' })).toEqual({ kind: 'rule', merchant: 'zomato', direction: 'debit' });
    expect(ruleFromEntry({ counterparty: null, vpa: 'Shop@YBL', direction: 'debit' })).toEqual({ kind: 'rule', vpa: 'shop@ybl', direction: 'debit' });
    expect(ruleFromEntry({ counterparty: null, vpa: null, direction: 'debit' })).toBeNull();
  });
});

describe('localTime', () => {
  it('uses the given time zone offset', () => {
    expect(localTime('2026-10-21T03:10:00.000Z', 330)).toEqual({ minuteOfDay: 8 * 60 + 40, weekday: 3 });
  });
});

describe('proposePatterns (CAT-8)', () => {
  const now = new Date('2026-10-22T12:00:00.000Z');
  const correction = (i: number, over: Partial<Correction> = {}): Correction => ({
    transactionId: `t${i}`,
    categoryId: 'cat:transport.bus',
    direction: 'debit',
    amount: paise(2000),
    accountId: 'hdfc',
    payeeKind: 'person',
    minuteOfDay: 8 * 60 + 15 + i * 10,
    weekday: 1 + (i % 5),
    occurredAt: `2026-10-${String(10 + i).padStart(2, '0')}T03:00:00.000Z`,
    ...over,
  });

  it('proposes a pattern after three agreeing corrections', () => {
    const [proposal] = proposePatterns([correction(0), correction(1, { amount: paise(2500) }), correction(2, { amount: paise(1800) })], [], now);
    expect(proposal).toBeDefined();
    expect(proposal!.categoryId).toBe('cat:transport.bus');
    expect(proposal!.transactionIds).toHaveLength(3);
    const { match } = proposal!;
    expect(match).toMatchObject({ direction: 'debit', startMinute: 480, endMinute: 540, weekdays: [1, 2, 3, 4, 5], accountId: 'hdfc', payeeKind: 'person' });
    expect(match.minAmount).toBeLessThanOrEqual(1800);
    expect(match.maxAmount).toBeGreaterThanOrEqual(2500);
    expect(Number.isInteger(match.minAmount) && Number.isInteger(match.maxAmount)).toBe(true);
    expect(describePattern(match, 'HDFC Bank ••1234')).toMatch(/^₹\d+ to ₹\d+ from HDFC Bank ••1234 with people, weekdays 8 am to 9 am$/);
  });

  it('needs three corrections within 30 days', () => {
    expect(proposePatterns([correction(0), correction(1)], [], now)).toEqual([]);
    const old = correction(2, { occurredAt: '2026-09-01T03:00:00.000Z' });
    expect(proposePatterns([correction(0), correction(1), old], [], now)).toEqual([]);
  });

  it('needs amounts in one band and times in one window', () => {
    expect(proposePatterns([correction(0), correction(1), correction(2, { amount: paise(9000) })], [], now)).toEqual([]);
    expect(proposePatterns([correction(0), correction(1), correction(2, { minuteOfDay: 19 * 60 })], [], now)).toEqual([]);
  });

  it('does not propose again what the user declined', () => {
    const corrections = [correction(0), correction(1), correction(2)];
    const [proposal] = proposePatterns(corrections, [], now);
    const declined = rule({ status: 'declined', match: proposal!.match, categoryId: proposal!.categoryId });
    expect(proposePatterns(corrections, [declined], now)).toEqual([]);
  });
});

describe('shareableVpa', () => {
  it('keeps phone numbers away from the AI', () => {
    expect(shareableVpa('9876543210@ybl')).toBeNull();
    expect(shareableVpa('Swiggy@AxisBank')).toBe('swiggy@axisbank');
  });
});
