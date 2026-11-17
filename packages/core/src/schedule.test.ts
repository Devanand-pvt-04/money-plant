import { describe, expect, it } from 'vitest';
import { addDays, addMonthsToDate, atTimeOf, dateKey, daysBetween, isDateKey, nextOccurrence } from './schedule';

describe('nextOccurrence', () => {
  it('moves weekly payments by 7 days', () => {
    expect(nextOccurrence('2026-12-28', 'weekly')).toBe('2027-01-04');
  });

  it('keeps the day of the month, clamped to short months', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
    expect(nextOccurrence('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
    expect(nextOccurrence('2026-10-05', 'monthly')).toBe('2026-11-05');
    expect(nextOccurrence('2026-11-30', 'quarterly', 30)).toBe('2027-02-28');
    expect(nextOccurrence('2028-02-29', 'yearly', 29)).toBe('2029-02-28');
  });
});

describe('dates', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-10-23', '2026-10-26')).toBe(3);
    expect(daysBetween('2026-10-26', '2026-10-23')).toBe(-3);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('validates date keys', () => {
    expect(isDateKey('2026-10-25')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('25-10-2026')).toBe(false);
  });
});

describe('atTimeOf', () => {
  const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m - 1, d, h, min);

  it('keeps the date and takes the time of day from the moment', () => {
    const at = atTimeOf('2026-11-03', local(2026, 11, 17, 13, 15), local(2026, 11, 17, 13, 15));
    expect(dateKey(at)).toBe('2026-11-03');
    expect([at.getHours(), at.getMinutes()]).toEqual([13, 15]);
  });

  it('is never later than now', () => {
    const now = local(2026, 11, 17, 9, 30);
    expect(atTimeOf('2026-11-17', local(2026, 11, 16, 22, 0), now).getTime()).toBe(now.getTime());
  });

  it('accepts an ISO moment', () => {
    const moment = local(2026, 11, 10, 8, 5);
    const at = atTimeOf('2026-11-09', moment.toISOString(), local(2026, 11, 17, 0, 0));
    expect(dateKey(at)).toBe('2026-11-09');
    expect([at.getHours(), at.getMinutes()]).toEqual([8, 5]);
  });
});

describe('addMonthsToDate', () => {
  it.each([
    ['2026-10-24', -6, '2026-04-24'],
    ['2026-10-24', -12, '2025-10-24'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-01-15', -1, '2025-12-15'],
    ['2026-10-31', 1, '2026-11-30'],
  ])('%s plus %i months is %s', (key, months, expected) => {
    expect(addMonthsToDate(key, months)).toBe(expected);
  });
});
