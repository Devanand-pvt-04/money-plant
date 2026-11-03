import { describe, expect, it } from 'vitest';
import { addReviewSeconds, balanceMet, healthFigures, type HealthEntry } from './health';
import { paise } from './money';

const entry = (over: Partial<HealthEntry>): HealthEntry => ({
  kind: 'expense',
  status: 'confirmed',
  categoryReason: 'dictionary',
  sources: ['sms'],
  ...over,
});

describe('healthFigures', () => {
  it('counts entries with any source the user did not type as captured', () => {
    const figures = healthFigures(
      [
        entry({}),
        entry({ sources: ['manual'] }),
        entry({ sources: ['app_payment', 'sms'] }),
        entry({ sources: ['app_payment'] }),
        entry({ kind: 'adjustment', sources: ['manual'] }),
        entry({ kind: 'iou', sources: ['manual'] }),
      ],
      [],
    );
    expect(figures.captured).toMatchObject({ hits: 2, total: 4, share: 0.5, met: false });
  });

  it('counts automatic categories as accepted and user ones as edited', () => {
    const figures = healthFigures(
      [
        ...Array.from({ length: 9 }, () => entry({})),
        entry({ categoryReason: 'user' }),
        entry({ categoryReason: 'refund' }),
        entry({ status: 'pending' }),
        entry({ categoryReason: null }),
        entry({ kind: 'transfer', categoryReason: null }),
        entry({ sources: ['manual'], categoryReason: 'user' }),
      ],
      [],
    );
    expect(figures.categories).toMatchObject({ hits: 10, total: 11 });
    expect(figures.categories.met).toBe(true);
  });

  it('averages Review time over the days it was open', () => {
    expect(healthFigures([], [0, 60, 200, 0]).review).toEqual({ averageSeconds: 130, days: 2, met: false });
    expect(healthFigures([], [90]).review.met).toBe(true);
    expect(healthFigures([], []).review).toEqual({ averageSeconds: null, days: 0, met: null });
  });

  it('has no share with nothing to count', () => {
    expect(healthFigures([], []).captured).toEqual({ hits: 0, total: 0, share: null, met: null });
  });
});

describe('balanceMet', () => {
  it('allows ₹1 either way', () => {
    expect(balanceMet(paise(100))).toBe(true);
    expect(balanceMet(paise(-101))).toBe(false);
  });
});

describe('addReviewSeconds', () => {
  it('adds to the day and drops days before the window', () => {
    const log = addReviewSeconds({ '2026-10-01': 50, '2026-11-02': 30 }, '2026-11-02', 12.4, '2026-10-04');
    expect(log).toEqual({ '2026-11-02': 42 });
  });
});
