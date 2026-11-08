// Reading splits back from an entry's postings and summing a group's
// expenses (SPL-1 to SPL-3). Pure functions over an entry and the sets of the
// user's own and person accounts, so they can be tested without the phone's
// database; apps/mobile/src/lib/splits.ts loads the rows and does the writes.

import { DEFAULT_CURRENCY, paise, type CurrencyCode, type Paise } from '@money-plant/core';
import type { IouView } from './iou-views';
import type { LedgerTransaction } from './types';

/** Which account ids are the user's own money accounts, and which are people. */
export interface SplitAccounts {
  owned: ReadonlySet<string>;
  people: ReadonlySet<string>;
}

export interface EntrySplit {
  /** The money out this split divides. */
  total: Paise;
  categoryId: string | null;
  myShare: Paise;
  /** Person account id to share. */
  shares: Map<string, Paise>;
}

/**
 * How a split expense divides, read from its postings: money out of the user's
 * account, the user's share to the category, each person's share to them.
 * Null when it isn't a split expense. The caller also checks the entry has IOUs.
 */
export function readSplit(tx: LedgerTransaction, { owned, people }: SplitAccounts): EntrySplit | null {
  const personLegs = tx.postings.filter((p) => people.has(p.accountId) && p.amount > 0);
  if (tx.kind !== 'expense' || personLegs.length === 0) return null;
  const own = tx.postings.find((p) => owned.has(p.accountId));
  const category = tx.postings.find((p) => !owned.has(p.accountId) && !people.has(p.accountId));
  return {
    total: paise(Math.abs(own?.amount ?? 0)),
    categoryId: category?.accountId ?? null,
    myShare: paise(category?.amount ?? 0),
    shares: new Map(personLegs.map((p) => [p.accountId, p.amount])),
  };
}

/**
 * The money out a split can divide: an expense paid from exactly one of the
 * user's accounts. Null for anything else, a loan (kind iou) included.
 */
export function splittableAmount(tx: LedgerTransaction, { owned, people }: SplitAccounts): { total: Paise; categoryId: string | null } | null {
  if (tx.kind !== 'expense') return null;
  const own = tx.postings.filter((p) => owned.has(p.accountId));
  if (own.length !== 1 || own[0]!.amount >= 0) return null;
  const category = tx.postings.find((p) => !owned.has(p.accountId) && !people.has(p.accountId));
  return { total: paise(-own[0]!.amount), categoryId: category?.accountId ?? null };
}

export type ShareProblem = { code: 'wrong_sum'; sum: Paise; total: Paise } | { code: 'no_one' };

/** The user's share plus everyone else's must make the total, and someone else must have a share. */
export function checkSplitShares(total: Paise, myShare: Paise, shares: ReadonlyMap<string, Paise>): ShareProblem | null {
  const sum = paise([...shares.values()].reduce<number>((s, v) => s + v, myShare));
  if (sum !== total) return { code: 'wrong_sum', sum, total };
  if (shares.size === 0 || [...shares.values()].every((v) => v === 0)) return { code: 'no_one' };
  return null;
}

export interface GroupExpense {
  id: string;
  occurredAt: string;
  title: string;
  /** Null when the user paid. */
  payerName: string | null;
  /** The whole bill, when known. */
  total: Paise;
  /** How many people share it, the user included. */
  ways: number;
  /** Above zero they owe the user for it, below zero the user owes. */
  net: Paise;
  /** The currency of the bill (decision 0017). */
  currency: CurrencyCode;
}

/**
 * SPL-3: one expense of a group as the group screen shows it. The user paid
 * when money left one of their accounts; otherwise the person whose posting
 * is negative paid, and the bill's total comes from the manual source.
 */
export function groupExpense(tx: LedgerTransaction, owned: ReadonlySet<string>, nameOf: ReadonlyMap<string, string>): GroupExpense {
  const own = tx.postings.find((p) => owned.has(p.accountId));
  const personLegs = tx.postings.filter((p) => nameOf.has(p.accountId));
  const payer = own ? null : personLegs.find((p) => p.amount < 0);
  const manual = tx.sources.find((src) => src.kind === 'manual')?.parsedFields as { total?: unknown } | undefined;
  const total = own ? -own.amount : typeof manual?.total === 'number' ? manual.total : -(payer?.amount ?? 0);
  const mine = tx.postings.some((p) => !owned.has(p.accountId) && !nameOf.has(p.accountId) && p.amount > 0);
  return {
    id: tx.id,
    occurredAt: tx.occurredAt,
    title: tx.counterparty ?? tx.note ?? 'Expense',
    payerName: payer ? (nameOf.get(payer.accountId) ?? 'Someone') : null,
    total: paise(total),
    ways: (own ? personLegs.filter((p) => p.amount > 0).length : 1) + (mine && own ? 1 : 0),
    net: paise(personLegs.reduce((sum, p) => sum + p.amount, 0)),
    currency: (own ?? payer ?? personLegs[0])?.currency ?? DEFAULT_CURRENCY,
  };
}

/**
 * Each person's open balance from a group's expenses: what is still open on
 * the IOUs those expenses made, so a repayment (IOU-4) settles it here too.
 * Above zero they owe the user. Declined IOUs don't count.
 */
export function groupBalances<T extends Pick<IouView, 'personId' | 'transactionId' | 'state' | 'direction' | 'outstanding'>>(
  ious: readonly T[],
  expenseIds: ReadonlySet<string>,
  /** What an IOU's open amount counts as; a group in several currencies converts here (decision 0017). */
  amountOf: (iou: T) => number = (iou) => iou.outstanding,
): Map<string, Paise> {
  const open = new Map<string, Paise>();
  for (const iou of ious) {
    if (!iou.personId || !iou.transactionId || !expenseIds.has(iou.transactionId) || iou.state === 'declined') continue;
    const amount = amountOf(iou);
    open.set(iou.personId, paise((open.get(iou.personId) ?? 0) + (iou.direction === 'lent' ? amount : -amount)));
  }
  return open;
}
