import { describe, expect, it } from 'vitest';
import { matchContact, mobileFromVpa } from './contacts';
import { findPerson } from './payees';

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

describe('findPerson with several UPI IDs (decision 0021)', () => {
  it('recognises a payment from one of their other UPI IDs', () => {
    const people = [
      { id: 'ravi', name: 'Ravi', vpa: 'ravi@okicici', extraVpas: ['ravi.k@oksbi'] },
      { id: 'asha', name: 'Asha', vpa: 'asha@ybl' },
    ];
    expect(findPerson(people, { vpa: 'RAVI.K@oksbi', name: 'R KUMAR' })?.id).toBe('ravi');
  });
});

describe('findPerson by phone (decision 0021)', () => {
  it('recognises a UPI ID made from their mobile number', () => {
    const people = [{ id: 'ravi', name: 'Ravi', vpa: 'ravi@okicici', phone: '9876543210' }];
    expect(findPerson(people, { vpa: '9876543210-2@axl', name: null })?.id).toBe('ravi');
    expect(findPerson(people, { vpa: '9123456780@ybl', name: null })).toBeNull();
  });
});
