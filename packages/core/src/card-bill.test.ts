import { describe, expect, it } from 'vitest';
import { billStatus, dueDateFor, lastStatementDate, nextStatementDate, statementDateFor, statementEnd } from './card-bill';
import { paise } from './money';

describe('card billing cycle (decision 0024)', () => {
  it('finds the last and next statement dates, keeping short months', () => {
    expect(lastStatementDate('2026-11-13', 18)).toBe('2026-10-18');
    expect(lastStatementDate('2026-11-18', 18)).toBe('2026-11-18');
    expect(nextStatementDate('2026-11-18', 18)).toBe('2026-12-18');
    expect(nextStatementDate('2027-02-01', 31)).toBe('2027-02-28');
    expect(lastStatementDate('2027-03-01', 31)).toBe('2027-02-28');
  });

  it('dates a statement SMS by what it prints, else the statement day, else the day it came', () => {
    expect(statementDateFor('2026-11-20', '2026-11-18', null)).toBe('2026-11-18');
    expect(statementDateFor('2026-11-20', null, 18)).toBe('2026-11-18');
    // Too long after the statement day: it's a new day.
    expect(statementDateFor('2026-11-28', null, 18)).toBe('2026-11-28');
    expect(statementDateFor('2026-11-20', null, null)).toBe('2026-11-20');
  });

  it('works out the due date and whether payments cleared the bill', () => {
    expect(dueDateFor('2026-10-18', null, 18)).toBe('2026-11-05');
    expect(dueDateFor('2026-10-18', '2026-11-06', 18)).toBe('2026-11-06');
    const bill = { statementOn: '2026-10-18', dueOn: '2026-11-05', total: paise(310200), minimum: paise(16000) };
    expect(billStatus(bill, paise(313196), '2026-11-13')).toEqual({ paid: 313196, remaining: 0, cleared: true, daysLeft: -8 });
    expect(billStatus(bill, paise(100000), '2026-11-01')).toMatchObject({ remaining: 210200, cleared: false, daysLeft: 4 });
  });

  it('ends a statement day just before the next one starts', () => {
    const end = new Date(statementEnd('2026-10-18'));
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([18, 23, 59]);
  });
});
