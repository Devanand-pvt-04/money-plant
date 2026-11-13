import { describe, expect, it } from 'vitest';
import { parseCardStatement, parseCardStatementText } from './card-statement';

const now = new Date('2026-11-13T10:00:00+05:30');

describe('card statements (decision 0024)', () => {
  it.each([
    [
      'VM-HDFCBK',
      'Your HDFC Bank Credit Card ending 5678 statement is ready. Total due Rs.12,400.00, minimum due Rs.620.00. Pay by 05-11-2026.',
      { bank: 'hdfc', last4: '5678', totalDue: 1240000, minimumDue: 62000, dueDate: '2026-11-05', statementDate: null, kind: 'statement' },
    ],
    [
      'AX-ICICIT',
      'ICICI Bank Credit Card XX7002 Statement dated 18-Oct-26: Total Amount Due INR 3,102.00, Minimum Amount Due INR 160.00, due by 05-Nov-26.',
      { bank: 'icici', last4: '7002', totalDue: 310200, minimumDue: 16000, dueDate: '2026-11-05', statementDate: '2026-10-18', kind: 'statement' },
    ],
    [
      'AD-SBICRD',
      'Your SBI Credit Card ending 5678 payment of Rs.12,400 is due on 05/11/26.',
      { bank: 'sbi', last4: '5678', totalDue: 1240000, dueDate: '2026-11-05', kind: 'reminder' },
    ],
  ] as const)('reads %s', (sender, body, expected) => {
    expect(parseCardStatement({ sender, body }, now)).toMatchObject(expected);
  });

  it('works for any bank', () => {
    expect(parseCardStatementText(null, 'Statement for your Credit Card XX4321 generated. Total outstanding: Rs 8,000.50. Due date 01-12-2026', now)).toMatchObject({
      last4: '4321',
      totalDue: 800050,
      dueDate: '2026-12-01',
    });
  });

  it.each([
    'Payment of INR 18,500.00 towards ICICI Bank Credit Card XX5678 has been received on 12-Oct-26. Thank you.',
    'INR 1,299.00 spent using ICICI Bank Card XX5678 on 21-Oct-26 on AMAZON. Avl Limit: INR 98,701.00.',
    'Your a/c XX1234 statement for October is ready. Download from NetBanking.',
  ])('leaves other messages alone: %s', (body) => {
    expect(parseCardStatementText('icici', body, now)).toBeNull();
  });
});
