import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { overspends, reviewSuggestions, type ReviewLine } from './review';

const r = (rupees: number) => paise(rupees * 100);
const line = (over: Partial<ReviewLine> & { categoryId: string }): ReviewLine => ({
  spent: r(0),
  limit: null,
  previous: [r(0), r(0), r(0)],
  canStart: false,
  ...over,
});

describe('overspends', () => {
  it('lists budgets that went over, largest first, with the usual spend', () => {
    const result = overspends([
      line({ categoryId: 'food', spent: r(6400), limit: r(4000), previous: [r(3000), r(4000), r(5000)] }),
      line({ categoryId: 'travel', spent: r(5500), limit: r(5000) }),
      line({ categoryId: 'rent', spent: r(12500), limit: r(12500) }),
      line({ categoryId: 'misc', spent: r(900) }),
    ]);
    expect(result).toEqual([
      { categoryId: 'food', spent: r(6400), limit: r(4000), over: r(2400), average: r(4000) },
      { categoryId: 'travel', spent: r(5500), limit: r(5000), over: r(500), average: r(0) },
    ]);
  });
});

describe('reviewSuggestions', () => {
  it('raises a budget overspent in 2 of the last 3 months to their average', () => {
    const [s] = reviewSuggestions([line({ categoryId: 'food', limit: r(4000), spent: r(5200), previous: [r(9000), r(3800), r(4600)] })]);
    // (3800 + 4600 + 5200) / 3 = 4533, rounded up to ₹5,000. The oldest month is not used.
    expect(s).toEqual({ categoryId: 'food', kind: 'raise', current: r(4000), suggested: r(5000) });
  });

  it('leaves a budget alone when only one month went over', () => {
    expect(reviewSuggestions([line({ categoryId: 'food', limit: r(4000), spent: r(5200), previous: [r(0), r(3000), r(3900)] })])).toEqual([]);
  });

  it('lowers a budget that stayed well under in every month', () => {
    const [s] = reviewSuggestions([line({ categoryId: 'fun', limit: r(5000), spent: r(1200), previous: [r(0), r(2000), r(1500)] })]);
    expect(s).toEqual({ categoryId: 'fun', kind: 'lower', current: r(5000), suggested: r(2000) });
  });

  it('offers budgets only to categories that can start one and spend enough, largest 3', () => {
    const result = reviewSuggestions([
      line({ categoryId: 'a', canStart: true, spent: r(3000), previous: [r(0), r(3000), r(3000)] }),
      line({ categoryId: 'b', canStart: true, spent: r(9000), previous: [r(0), r(9000), r(9000)] }),
      line({ categoryId: 'c', canStart: true, spent: r(6000), previous: [r(0), r(6000), r(6000)] }),
      line({ categoryId: 'd', canStart: true, spent: r(4000), previous: [r(0), r(4000), r(4000)] }),
      line({ categoryId: 'small', canStart: true, spent: r(600), previous: [r(0), r(600), r(600)] }),
      line({ categoryId: 'child', canStart: false, spent: r(8000), previous: [r(0), r(8000), r(8000)] }),
    ]);
    expect(result.map((s) => [s.categoryId, s.kind, s.suggested])).toEqual([
      ['b', 'start', r(9000)],
      ['c', 'start', r(6000)],
      ['d', 'start', r(4000)],
    ]);
  });

  it('puts raises before lowers before new budgets', () => {
    const result = reviewSuggestions([
      line({ categoryId: 'new', canStart: true, spent: r(3000), previous: [r(0), r(3000), r(3000)] }),
      line({ categoryId: 'low', limit: r(5000), spent: r(1000), previous: [r(0), r(1000), r(1000)] }),
      line({ categoryId: 'high', limit: r(1000), spent: r(2000), previous: [r(0), r(2000), r(2000)] }),
    ]);
    expect(result.map((s) => s.kind)).toEqual(['raise', 'lower', 'start']);
  });

  it('suggests nothing for a month with no spending', () => {
    expect(reviewSuggestions([line({ categoryId: 'x', limit: r(1000) })])).toEqual([]);
  });
});
