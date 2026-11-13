import { describe, expect, it } from 'vitest';
import {
  identifierClashes,
  isSelfPayee,
  isStrong,
  matchPayee,
  mergeIdentifiers,
  normaliseIdentifier,
  payeeIdentifiers,
  sameIdentifier,
  type Identifier,
  type IdentifiedPerson,
} from './identity';

const id = (kind: Identifier['kind'], raw: string, label?: string) => normaliseIdentifier(kind, raw, label)!;
const person = (pid: string, name: string, ...identifiers: Identifier[]): IdentifiedPerson => ({ id: pid, name, identifiers });

describe('normaliseIdentifier (decision 0025)', () => {
  it('lower-cases UPI IDs and rejects other text', () => {
    expect(normaliseIdentifier('upi', ' Tushar@OKAxis ')).toEqual({ kind: 'upi', value: 'tushar@okaxis' });
    expect(normaliseIdentifier('upi', 'tushar')).toBeNull();
  });

  it('keeps the 10-digit mobile number', () => {
    expect(normaliseIdentifier('phone', '+91 98765-43210')).toEqual({ kind: 'phone', value: '9876543210' });
    expect(normaliseIdentifier('phone', '12345')).toBeNull();
  });

  it('keeps account digits and the bank', () => {
    expect(normaliseIdentifier('bank_account', 'XX1234', 'HDFC Bank')).toEqual({ kind: 'bank_account', value: '1234', label: 'hdfc' });
    expect(normaliseIdentifier('bank_account', 'abcd')).toBeNull();
  });

  it('keeps payee names as plain lower-case words', () => {
    expect(normaliseIdentifier('payee_name', 'MOOLAM  TUSHAR.')).toEqual({ kind: 'payee_name', value: 'moolam tushar' });
  });
});

describe('strength', () => {
  it('UPI IDs and phones are strong; names never are', () => {
    expect(isStrong(id('upi', 'aa@ybl'))).toBe(true);
    expect(isStrong(id('phone', '9876543210'))).toBe(true);
    expect(isStrong(id('payee_name', 'Ravi'))).toBe(false);
  });

  it('a bank account is strong only with its bank', () => {
    expect(isStrong(id('bank_account', '1234', 'hdfc'))).toBe(true);
    expect(isStrong(id('bank_account', '1234'))).toBe(false);
  });

  it('a phone matches a UPI ID made from it', () => {
    expect(sameIdentifier(id('phone', '9876543210'), id('upi', '9876543210@ybl'))).toBe(true);
    expect(sameIdentifier(id('upi', '9876543210-2@axl'), id('phone', '9876543210'))).toBe(true);
  });

  it('account digits match on the shorter number', () => {
    expect(sameIdentifier(id('bank_account', '50100012341234', 'hdfc'), id('bank_account', '1234', 'hdfc'))).toBe(true);
    expect(sameIdentifier(id('bank_account', '1234', 'hdfc'), id('bank_account', '1234', 'sbi'))).toBe(false);
  });
});

describe('matchPayee', () => {
  const tushar = person('t', 'Tushar', id('upi', 'tushar@okaxis'), id('phone', '9876543210'), id('bank_account', '1234', 'hdfc'), { ...id('payee_name', 'MOOLAM TUSHAR'), source: 'learned' });
  const ravi1 = person('r1', 'Ravi', id('upi', 'ravi@ybl'));
  const ravi2 = person('r2', 'Ravi', id('upi', 'ravik@ybl'));
  const people = [tushar, ravi1, ravi2];

  it('matches any of a person\'s UPI IDs for certain', () => {
    expect(matchPayee(people, { vpa: 'Tushar@okaxis', name: 'Someone' })).toMatchObject({ person: { id: 't' }, strength: 'strong', via: 'upi' });
  });

  it('matches a UPI ID made from their phone number', () => {
    expect(matchPayee(people, { vpa: '9876543210@paytm', name: null })).toMatchObject({ person: { id: 't' }, strength: 'strong' });
  });

  it('matches a bank account with its bank for certain', () => {
    expect(matchPayee(people, { vpa: null, name: null, account: { digits: 'XX1234', bank: 'HDFC' } })).toMatchObject({ person: { id: 't' }, strength: 'strong', via: 'bank_account' });
  });

  it('only suggests on account digits without a bank', () => {
    expect(matchPayee(people, { vpa: null, name: null, account: { digits: '1234' } })).toMatchObject({ person: { id: 't' }, strength: 'suggested' });
  });

  it('uses a name exactly one person has learned', () => {
    expect(matchPayee(people, { vpa: 'other@upi', name: 'Moolam Tushar' })).toMatchObject({ person: { id: 't' }, strength: 'learned' });
  });

  it('never picks between two people with the same name', () => {
    expect(matchPayee(people, { vpa: null, name: 'RAVI' })).toBeNull();
  });

  it('only suggests a person by their own name', () => {
    expect(matchPayee([tushar, ravi1], { vpa: null, name: 'Ravi' })).toMatchObject({ person: { id: 'r1' }, strength: 'suggested', via: 'name' });
  });

  it('returns nothing when a strong identifier is on two people', () => {
    const twin = person('x', 'Twin', id('upi', 'tushar@okaxis'));
    expect(matchPayee([tushar, twin], { vpa: 'tushar@okaxis', name: null })).toBeNull();
  });
});

describe('identifierClashes', () => {
  const tushar = person('t', 'Tushar', id('upi', 'tushar@okaxis'), id('payee_name', 'Tushar'));
  const peakesh = person('p', 'Peakesh Reddy');

  it('finds another person with the same strong identifier', () => {
    expect(identifierClashes([tushar, peakesh], 'p', [id('upi', 'TUSHAR@okaxis')])).toMatchObject([{ person: { id: 't' } }]);
  });

  it('finds a phone that another person has as a UPI ID', () => {
    const t2 = person('t', 'Tushar', id('upi', '9876543210@ybl'));
    expect(identifierClashes([t2, peakesh], 'p', [id('phone', '9876543210')])).toHaveLength(1);
  });

  it('ignores names and the person being edited', () => {
    expect(identifierClashes([tushar, peakesh], 'p', [id('payee_name', 'Tushar')])).toEqual([]);
    expect(identifierClashes([tushar, peakesh], 't', [id('upi', 'tushar@okaxis')])).toEqual([]);
  });
});

describe('payeeIdentifiers and self', () => {
  it('learns the UPI ID, its phone, the account and the name', () => {
    expect(payeeIdentifiers({ vpa: '9876543210@ybl', name: 'MOOLAM TUSHAR', account: { digits: '1234', bank: 'hdfc' } }).map((i) => i.kind)).toEqual([
      'upi',
      'phone',
      'bank_account',
      'payee_name',
    ]);
  });

  it('a payment to one of my own UPI IDs or accounts is to myself', () => {
    const mine = [id('upi', 'deva@okicici'), id('bank_account', '7002', 'icici')];
    expect(isSelfPayee(mine, { vpa: 'deva@okicici', name: 'DEVANAND' })).toBe(true);
    expect(isSelfPayee(mine, { vpa: null, name: null, account: { digits: '7002', bank: 'ICICI Bank' } })).toBe(true);
    expect(isSelfPayee(mine, { vpa: null, name: 'DEVANAND' })).toBe(false);
  });

  it('mergeIdentifiers skips ones already there', () => {
    expect(mergeIdentifiers([id('upi', 'aa@ybl')], [id('upi', 'aa@ybl'), id('upi', 'bb@ybl')])).toHaveLength(2);
  });
});

describe('findDuplicatePeople with bank accounts', () => {
  it('pairs two people with the same account and bank', async () => {
    const { findDuplicatePeople } = await import('./people');
    const a = { id: 'a', name: 'Tushar', vpa: null, email: 't@x.com', identifiers: [id('bank_account', '1234', 'hdfc')] };
    const b = { id: 'b', name: 'Peakesh', vpa: null, email: null, identifiers: [id('bank_account', '501001234', 'hdfc')] };
    expect(findDuplicatePeople([a, b])).toEqual([{ keep: 'a', remove: 'b', reason: 'account' }]);
  });
});
