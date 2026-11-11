import { describe, expect, it } from 'vitest';
import { clashingPerson, findDuplicatePeople, mergeDirection, pairKey } from './people';

const person = (id: string, name: string, extra: { vpa?: string | null; email?: string | null } = {}) => ({
  id,
  name,
  vpa: extra.vpa ?? null,
  email: extra.email ?? null,
});

describe('clashingPerson (decision 0020)', () => {
  const people = [person('t', 'Tushar', { email: 'tushar@gmail.com', vpa: 'tushar@okicici' }), person('p', 'Peakesh')];

  it('finds someone else with the same email, ignoring case', () => {
    expect(clashingPerson(people, 'p', { email: 'Tushar@Gmail.com', vpa: null })).toMatchObject({ person: { id: 't' }, field: 'email' });
  });

  it('finds someone else with the same UPI ID', () => {
    expect(clashingPerson(people, 'p', { email: null, vpa: 'tushar@okicici' })).toMatchObject({ person: { id: 't' }, field: 'vpa' });
  });

  it('ignores the person being edited', () => {
    expect(clashingPerson(people, 't', { email: 'tushar@gmail.com', vpa: 'tushar@okicici' })).toBeNull();
  });
});

describe('mergeDirection', () => {
  it('keeps the person linked on Money Plant', () => {
    const d = mergeDirection(person('p', 'Peakesh'), person('t', 'Tushar', { email: 'tushar@gmail.com' }));
    expect(d?.keep.id).toBe('t');
    expect(d?.remove.id).toBe('p');
  });

  it('refuses two different members', () => {
    expect(mergeDirection(person('a', 'A', { email: 'a@x.com' }), person('b', 'B', { email: 'b@x.com' }))).toBeNull();
  });
});

describe('findDuplicatePeople', () => {
  it('pairs people with the same UPI ID, keeping the friend', () => {
    const pairs = findDuplicatePeople([
      person('p', 'Peakesh Reddy', { vpa: 'moolam@okicici' }),
      person('t', 'Tushar', { vpa: 'moolam@okicici', email: 'moolam@gmail.com' }),
    ]);
    expect(pairs).toEqual([{ keep: 't', remove: 'p', reason: 'vpa' }]);
  });

  it('pairs the same name when one has no email', () => {
    expect(findDuplicatePeople([person('a', 'Ravi K'), person('b', 'ravi k.', { email: 'ravi@x.com' })])).toEqual([
      { keep: 'b', remove: 'a', reason: 'name' },
    ]);
  });

  it('does not pair two members who share a name', () => {
    expect(findDuplicatePeople([person('a', 'Ravi', { email: 'r1@x.com' }), person('b', 'Ravi', { email: 'r2@x.com' })])).toEqual([]);
  });

  it('leaves out pairs the user said are different people', () => {
    expect(findDuplicatePeople([person('a', 'Ravi'), person('b', 'Ravi')], new Set([pairKey('b', 'a')]))).toEqual([]);
  });
});
