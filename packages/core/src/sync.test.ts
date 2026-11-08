import { describe, expect, it } from 'vitest';
import { isRejection, pushWithFallback } from './sync';

describe('isRejection', () => {
  it('counts data the server refused', () => {
    for (const code of ['23514', '23503', '42501', '22P02', 'P0001']) expect(isRejection({ code })).toBe(true);
  });

  it('leaves out failures a retry may fix', () => {
    for (const code of ['', '08006', '57014', '53300', 'PGRST301', undefined]) expect(isRejection({ code })).toBe(false);
    expect(isRejection(null)).toBe(false);
    expect(isRejection(new Error('Network request failed'))).toBe(false);
  });
});

const refuse = (bad: Set<number>, code = '23514') => async (batch: readonly number[]) => ({
  error: batch.some((n) => bad.has(n)) ? { code } : null,
});

describe('pushWithFallback', () => {
  it('sends a good batch in one call', async () => {
    const calls: number[][] = [];
    const out = await pushWithFallback([1, 2, 3], async (b) => (calls.push([...b]), { error: null }), isRejection);
    expect(out).toEqual({ sent: [1, 2, 3], rejected: [] });
    expect(calls).toEqual([[1, 2, 3]]);
  });

  it('sets aside only the item the server refuses', async () => {
    const out = await pushWithFallback([1, 2, 3], refuse(new Set([2])), isRejection);
    expect(out.sent).toEqual([1, 3]);
    expect(out.rejected).toEqual([{ item: 2, error: { code: '23514' } }]);
  });

  it('sets aside a single refused item', async () => {
    const out = await pushWithFallback([7], refuse(new Set([7])), isRejection);
    expect(out).toEqual({ sent: [], rejected: [{ item: 7, error: { code: '23514' } }] });
  });

  it('throws when the batch fails for another reason, setting nothing aside', async () => {
    await expect(pushWithFallback([1, 2], refuse(new Set([1]), ''), isRejection)).rejects.toEqual({ code: '' });
  });

  it('throws if the connection drops partway through the one-by-one pass', async () => {
    let call = 0;
    const push = async (batch: readonly number[]) => {
      call++;
      if (call === 1) return { error: { code: '23514' } };
      return { error: batch[0] === 2 ? { code: '' } : null };
    };
    await expect(pushWithFallback([1, 2, 3], push, isRejection)).rejects.toEqual({ code: '' });
  });

  it('does nothing with nothing to send', async () => {
    expect(await pushWithFallback([], async () => ({ error: { code: '23514' } }), isRejection)).toEqual({ sent: [], rejected: [] });
  });
});
