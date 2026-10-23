import { paise, type DateKey, type Paise } from '@money-plant/core';
import type { LedgerPosting } from './types';

/**
 * IOUs (IOU-1 to IOU-5) seen from this user's side. A shared IOU is the same
 * row for both people; `direction` and `personId` are always from the
 * viewer's side, so "lent" for the lender is "borrowed" for the borrower.
 */
export type IouDirection = 'lent' | 'borrowed';

export interface Iou {
  id: string;
  /** The viewer's person account for the other side; null until a counterparty confirms. */
  personId: string | null;
  direction: IouDirection;
  amount: Paise;
  reason: string | null;
  occurredOn: DateKey;
  dueDate: DateKey | null;
}

export interface IouPayment {
  id: string;
  iouId: string;
  /** Recorded by the viewer (from their own ledger) or by the other person. */
  byMe: boolean;
  amount: Paise;
  paidAt: string;
}

/**
 * What is still owed. Each side records the repayments its own ledger saw;
 * for a shared IOU both sides usually see the same payment (the lender's
 * credit and the borrower's debit), so the larger side's total counts, never
 * both. Never below zero.
 */
export function outstanding(iou: Pick<Iou, 'id' | 'amount'>, payments: readonly IouPayment[]): Paise {
  let mine = 0;
  let theirs = 0;
  for (const p of payments) {
    if (p.iouId !== iou.id) continue;
    if (p.byMe) mine += p.amount;
    else theirs += p.amount;
  }
  return paise(Math.max(0, iou.amount - Math.max(mine, theirs)));
}

/** Oldest due first: IOUs with a due date by date, then the rest by when they started. */
export function settlementOrder<T extends Pick<Iou, 'dueDate' | 'occurredOn'>>(ious: readonly T[]): T[] {
  return [...ious].sort((a, b) => {
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0;
  });
}

/**
 * IOU-4: spreads a repayment over a person's open IOUs, oldest due first, so a
 * partial payment reduces the balance and a large one settles several.
 * Returns what each IOU gets and what is left over (an overpayment).
 */
export function allocateRepayment(
  open: readonly (Pick<Iou, 'id' | 'dueDate' | 'occurredOn'> & { outstanding: Paise })[],
  amount: Paise,
): { parts: { iouId: string; amount: Paise }[]; leftover: Paise } {
  let left: number = amount;
  const parts: { iouId: string; amount: Paise }[] = [];
  for (const iou of settlementOrder(open)) {
    if (left <= 0) break;
    const take = Math.min(left, iou.outstanding);
    if (take <= 0) continue;
    parts.push({ iouId: iou.id, amount: paise(take) });
    left -= take;
  }
  return { parts, leftover: paise(left) };
}

export interface PersonRef {
  id: string;
  name: string;
  vpa: string | null;
}

const normaliseName = (name: string) => name.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The user's person account a payment was to or from: same UPI ID, or the same name. */
export function findPerson<T extends PersonRef>(people: readonly T[], payee: { vpa: string | null; name: string | null }): T | null {
  if (payee.vpa) {
    const vpa = payee.vpa.toLowerCase();
    const byVpa = people.find((p) => p.vpa?.toLowerCase() === vpa);
    if (byVpa) return byVpa;
  }
  if (!payee.name) return null;
  const name = normaliseName(payee.name);
  if (!name) return null;
  const byName = people.filter((p) => normaliseName(p.name) === name);
  return byName.length === 1 ? byName[0]! : null;
}

/**
 * IOU-4 matching rule "IOU settlement": money from a person who owes the
 * user (or to a person the user owes), for no more than what is open, is a
 * repayment. Returns how it settles, or null when it isn't one.
 */
export function matchRepayment(
  payment: { direction: 'debit' | 'credit'; amount: Paise; vpa: string | null; name: string | null },
  people: readonly PersonRef[],
  open: readonly (Iou & { outstanding: Paise })[],
): { personId: string; parts: { iouId: string; amount: Paise }[] } | null {
  const person = findPerson(people, payment);
  if (!person) return null;
  const direction: IouDirection = payment.direction === 'credit' ? 'lent' : 'borrowed';
  const theirs = open.filter((iou) => iou.personId === person.id && iou.direction === direction && iou.outstanding > 0);
  const total = theirs.reduce((sum, iou) => sum + iou.outstanding, 0);
  if (total === 0 || payment.amount > total) return null;
  return { personId: person.id, parts: allocateRepayment(theirs, payment.amount).parts };
}

/**
 * SPL-1: postings for an entry split among people. The paying leg stays as it
 * is; the user's own share goes to the category (left out when zero) and each
 * person's share to their person account, so they owe it. Sums to zero.
 */
export function splitPostings(
  payingLeg: LedgerPosting,
  categoryId: string,
  myShare: Paise,
  personShares: ReadonlyMap<string, Paise>,
  newId: () => string,
): LedgerPosting[] {
  const out: LedgerPosting[] = [payingLeg];
  if (myShare > 0) out.push({ id: newId(), accountId: categoryId, amount: myShare });
  for (const [personId, share] of personShares) {
    if (share > 0) out.push({ id: newId(), accountId: personId, amount: share });
  }
  return out;
}

/**
 * SPL-2: someone else paid. The user's share is spending on the category and
 * a debt to the payer's person account; no account of the user's moves.
 */
export function paidByOtherPostings(payerId: string, categoryId: string, myShare: Paise, newId: () => string): LedgerPosting[] {
  return [
    { id: newId(), accountId: categoryId, amount: myShare },
    { id: newId(), accountId: payerId, amount: paise(-myShare) },
  ];
}
