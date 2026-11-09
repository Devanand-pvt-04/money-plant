import { paise, type Paise } from './money';

/**
 * NW-1: money lent and borrowed in net worth. A person's balance is what their
 * person account holds in the home currency: above zero they owe the user (an
 * asset), below zero the user owes them (a liability).
 */
export interface PersonWorth {
  id: string;
  /** In the home currency, signed: above zero they owe the user. */
  balance: number;
}

export interface LentBorrowed {
  /** What others owe the user and counts toward net worth. */
  lent: Paise;
  /** What the user owes others. Always counts. */
  borrowed: Paise;
  /** lent − borrowed: what IOUs add to net worth. */
  net: Paise;
  /** What people the user doubts will pay back owe, left out of `lent`. */
  leftOut: Paise;
  /** How many people that is. */
  leftOutCount: number;
}

/**
 * Adds up person balances for net worth. `doubtful` holds the people whose
 * debt to the user is left out, for loans the user doubts will come back.
 * Only what they owe the user is left out: what the user owes them is a real
 * debt either way, so it still counts.
 */
export function lentBorrowed(people: readonly PersonWorth[], doubtful: ReadonlySet<string> = new Set()): LentBorrowed {
  let lent = 0;
  let borrowed = 0;
  let leftOut = 0;
  let leftOutCount = 0;
  for (const p of people) {
    if (p.balance < 0) borrowed -= p.balance;
    else if (p.balance > 0 && doubtful.has(p.id)) {
      leftOut += p.balance;
      leftOutCount += 1;
    } else lent += p.balance;
  }
  return { lent: paise(lent), borrowed: paise(borrowed), net: paise(lent - borrowed), leftOut: paise(leftOut), leftOutCount };
}

/** The people whose postings count in rebuilt net worth months: everyone but the doubtful ones the user is owed by. */
export function countedPeople(people: readonly PersonWorth[], doubtful: ReadonlySet<string> = new Set()): string[] {
  return people.filter((p) => !(p.balance > 0 && doubtful.has(p.id))).map((p) => p.id);
}
