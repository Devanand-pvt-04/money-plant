import { describe, expect, it } from 'vitest';
import { countedPeople, lentBorrowed } from './owed';

describe('lentBorrowed (NW-1)', () => {
  const people = [
    { id: 'ravi', balance: 50_000 },
    { id: 'asha', balance: -20_000 },
    { id: 'kiran', balance: 30_000 },
    { id: 'meera', balance: 0 },
  ];

  it('counts money owed to the user as lent and money the user owes as borrowed', () => {
    expect(lentBorrowed(people)).toEqual({ lent: 80_000, borrowed: 20_000, net: 60_000, leftOut: 0, leftOutCount: 0 });
  });

  it('is zero with nobody', () => {
    expect(lentBorrowed([])).toEqual({ lent: 0, borrowed: 0, net: 0, leftOut: 0, leftOutCount: 0 });
  });

  it('leaves out what doubtful people owe', () => {
    expect(lentBorrowed(people, new Set(['kiran']))).toEqual({ lent: 50_000, borrowed: 20_000, net: 30_000, leftOut: 30_000, leftOutCount: 1 });
  });

  it('still counts what the user owes someone marked doubtful', () => {
    expect(lentBorrowed(people, new Set(['asha', 'meera']))).toEqual({ lent: 80_000, borrowed: 20_000, net: 60_000, leftOut: 0, leftOutCount: 0 });
  });

  it('can go below zero when the user owes more than they are owed', () => {
    expect(lentBorrowed([{ id: 'a', balance: 1_000 }, { id: 'b', balance: -5_000 }]).net).toBe(-4_000);
  });
});

describe('countedPeople', () => {
  it('drops only doubtful people who owe the user', () => {
    const people = [
      { id: 'ravi', balance: 50_000 },
      { id: 'asha', balance: -20_000 },
      { id: 'meera', balance: 0 },
    ];
    expect(countedPeople(people, new Set(['ravi', 'asha']))).toEqual(['asha', 'meera']);
  });
});
