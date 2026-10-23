import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { splitAmount } from './split';

const shares = (result: ReturnType<typeof splitAmount>) => ('shares' in result ? [...result.shares.values()] : result.error);

describe('splitAmount (SPL-1)', () => {
  it('splits equally, giving leftover paise to the first people', () => {
    expect(shares(splitAmount(paise(10000), 'equal', [{ id: 'me', value: 0 }, { id: 'a', value: 0 }, { id: 'b', value: 0 }]))).toEqual([3334, 3333, 3333]);
    expect(shares(splitAmount(paise(120000), 'equal', ['me', 'a', 'b', 'c'].map((id) => ({ id, value: 0 }))))).toEqual([30000, 30000, 30000, 30000]);
  });

  it('takes exact amounts only when they add up', () => {
    expect(shares(splitAmount(paise(1000), 'exact', [{ id: 'me', value: 400 }, { id: 'a', value: 600 }]))).toEqual([400, 600]);
    expect(splitAmount(paise(1000), 'exact', [{ id: 'me', value: 400 }, { id: 'a', value: 500 }])).toEqual({ error: { code: 'exact_mismatch', difference: 100 } });
  });

  it('splits by percentages that make 100%', () => {
    expect(shares(splitAmount(paise(999), 'percent', [{ id: 'me', value: 5000 }, { id: 'a', value: 5000 }]))).toEqual([500, 499]);
    expect(splitAmount(paise(999), 'percent', [{ id: 'me', value: 5000 }, { id: 'a', value: 4000 }])).toEqual({ error: { code: 'percent_mismatch', total: 9000 } });
  });

  it('splits by shares and always sums to the total', () => {
    const result = splitAmount(paise(100001), 'shares', [{ id: 'me', value: 1 }, { id: 'a', value: 2 }, { id: 'b', value: 0 }, { id: 'c', value: 3 }]);
    const values = shares(result) as number[];
    expect(values.reduce((s, v) => s + v, 0)).toBe(100001);
    expect(values[2]).toBe(0);
  });

  it('rejects empty and fractional input', () => {
    expect(splitAmount(paise(100), 'equal', [])).toEqual({ error: { code: 'no_parts' } });
    expect(splitAmount(paise(100), 'shares', [{ id: 'a', value: 1.5 }])).toEqual({ error: { code: 'bad_value', id: 'a' } });
  });
});
