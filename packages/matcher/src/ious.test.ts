import { describe, expect, it } from 'vitest';
import { paise, validatePostings } from '@money-plant/core';
import { matchContact, mobileFromVpa } from './contacts';
import { allocateRepayment, findPerson, matchRepayment, outstanding, paidByOtherPostings, splitPostings, type Iou } from './ious';

const iou = (id: string, rupees: number, extra: Partial<Iou> = {}): Iou => ({
  id,
  personId: 'ravi',
  direction: 'lent',
  amount: paise(rupees * 100),
  reason: null,
  occurredOn: '2026-10-01',
  dueDate: null,
  ...extra,
});

describe('outstanding (IOU-4)', () => {
  it('counts the larger side of a shared IOU once', () => {
    const payments = [
      { id: 'a', iouId: 'i', byMe: true, amount: paise(50000), paidAt: '' },
      { id: 'b', iouId: 'i', byMe: false, amount: paise(50000), paidAt: '' },
      { id: 'c', iouId: 'i', byMe: false, amount: paise(30000), paidAt: '' },
      { id: 'd', iouId: 'other', byMe: true, amount: paise(99999), paidAt: '' },
    ];
    expect(outstanding(iou('i', 2000), payments)).toBe(120000);
  });

  it('never goes below zero', () => {
    expect(outstanding(iou('i', 10), [{ id: 'a', iouId: 'i', byMe: true, amount: paise(5000), paidAt: '' }])).toBe(0);
  });
});

describe('allocateRepayment', () => {
  it('settles the oldest due first and reports an overpayment', () => {
    const open = [
      { ...iou('later', 500, { dueDate: '2026-11-30' }), outstanding: paise(50000) },
      { ...iou('undated', 300), outstanding: paise(30000) },
      { ...iou('soon', 200, { dueDate: '2026-10-30' }), outstanding: paise(20000) },
    ];
    expect(allocateRepayment(open, paise(60000)).parts).toEqual([
      { iouId: 'soon', amount: 20000 },
      { iouId: 'later', amount: 40000 },
    ]);
    expect(allocateRepayment(open, paise(110000)).leftover).toBe(10000);
  });
});

describe('matchRepayment (IOU-4)', () => {
  const people = [
    { id: 'ravi', name: 'Ravi Kumar', vpa: 'ravi@okicici' },
    { id: 'priya', name: 'Priya S', vpa: null },
  ];
  const open = [
    { ...iou('lent-ravi', 2000), outstanding: paise(200000) },
    { ...iou('owe-priya', 500, { personId: 'priya', direction: 'borrowed' }), outstanding: paise(50000) },
  ];

  it('matches a credit from a person who owes the user, partial payments included', () => {
    expect(matchRepayment({ direction: 'credit', amount: paise(150000), vpa: 'ravi@okicici', name: 'RAVI KUMAR' }, people, open)).toEqual({
      personId: 'ravi',
      parts: [{ iouId: 'lent-ravi', amount: 150000 }],
    });
  });

  it('matches a debit to a person the user owes, by name', () => {
    expect(matchRepayment({ direction: 'debit', amount: paise(50000), vpa: null, name: 'PRIYA S' }, people, open)?.personId).toBe('priya');
  });

  it('ignores more than is owed, the wrong direction and strangers', () => {
    expect(matchRepayment({ direction: 'credit', amount: paise(250000), vpa: 'ravi@okicici', name: null }, people, open)).toBeNull();
    expect(matchRepayment({ direction: 'debit', amount: paise(1000), vpa: 'ravi@okicici', name: null }, people, open)).toBeNull();
    expect(matchRepayment({ direction: 'credit', amount: paise(1000), vpa: 'x@ybl', name: 'Someone Else' }, people, open)).toBeNull();
  });

  it('does not guess between two people with the same name', () => {
    expect(findPerson([{ id: 'a', name: 'Ravi', vpa: null }, { id: 'b', name: 'RAVI', vpa: null }], { vpa: null, name: 'ravi' })).toBeNull();
  });
});

describe('split postings (SPL-1, SPL-2)', () => {
  let n = 0;
  const newId = () => `p${n++}`;

  it('keeps the paying leg and balances', () => {
    const postings = splitPostings(
      { id: 'bank', accountId: 'hdfc', amount: paise(-120000) },
      'eating-out',
      paise(30000),
      new Map([['a', paise(30000)], ['b', paise(30000)], ['c', paise(30000)]]),
      newId,
    );
    expect(postings).toHaveLength(5);
    expect(validatePostings(postings)).toBeNull();
    expect(postings[0]!.id).toBe('bank');
  });

  it('leaves out a zero share for the user', () => {
    const postings = splitPostings({ id: 'bank', accountId: 'hdfc', amount: paise(-1000) }, 'food', paise(0), new Map([['a', paise(1000)]]), newId);
    expect(postings.map((p) => p.accountId)).toEqual(['hdfc', 'a']);
  });

  it('records what the user owes when someone else paid', () => {
    const postings = paidByOtherPostings('ravi', 'travel', paise(45000), newId);
    expect(validatePostings(postings)).toBeNull();
    expect(postings.find((p) => p.accountId === 'ravi')!.amount).toBe(-45000);
  });
});

describe('matchContact (SPL-4)', () => {
  const contacts = [
    { id: '1', name: 'Ravi Kumar', phones: ['+91 98765 43210'] },
    { id: '2', name: 'Ravi Shankar', phones: ['080-2345678'] },
    { id: '3', name: 'Priya Sharma', phones: ['09123456780'] },
  ];

  it('matches by the mobile number in a UPI ID', () => {
    expect(mobileFromVpa('9876543210@ybl')).toBe('9876543210');
    expect(mobileFromVpa('919876543210-2@axl')).toBe('9876543210');
    expect(matchContact({ vpa: '9876543210@ybl', name: 'R K' }, contacts)?.id).toBe('1');
  });

  it('matches abbreviated names only when one contact fits', () => {
    expect(matchContact({ vpa: null, name: 'PRIYA S' }, contacts)?.id).toBe('3');
    expect(matchContact({ vpa: null, name: 'RAVI' }, contacts)).toBeNull();
    expect(matchContact({ vpa: null, name: 'RAVI K' }, contacts)?.id).toBe('1');
  });
});
