import { describe, expect, it } from 'vitest';
import { paise } from './money';
import { reconcile } from './reconcile';

const p = (occurredAt: string, amount: number) => ({ occurredAt, amount: paise(amount) });
const a = (observedAt: string, balance: number) => ({ observedAt, balance: paise(balance) });

describe('reconcile', () => {
  it('returns null without anchors', () => {
    expect(reconcile(paise(0), [], [])).toBeNull();
  });

  it('matches when the ledger agrees with the bank', () => {
    const result = reconcile(
      paise(100000),
      [p('2026-10-01T10:00:00Z', -45000), p('2026-10-02T10:00:00Z', 200000)],
      [a('2026-10-01T10:00:00Z', 55000), a('2026-10-02T10:00:00Z', 255000)],
    );
    expect(result).toMatchObject({ flagged: false, latest: { gap: 0, computed: 255000 } });
  });

  it('tolerates a gap of up to ₹1', () => {
    const result = reconcile(paise(0), [], [a('2026-10-01T10:00:00Z', 100)]);
    expect(result?.flagged).toBe(false);
  });

  it('flags a missing entry and points to the window where it happened', () => {
    const result = reconcile(
      paise(100000),
      [p('2026-10-01T10:00:00Z', -45000), p('2026-10-05T10:00:00Z', -10000)],
      // A ₹200 debit between the 1st and the 5th never reached the ledger.
      [a('2026-10-01T10:00:00Z', 55000), a('2026-10-05T10:00:00Z', 25000)],
    );
    expect(result).toMatchObject({
      flagged: true,
      latest: { gap: -20000 },
      windowStart: '2026-10-01T10:00:00Z',
    });
  });
});
