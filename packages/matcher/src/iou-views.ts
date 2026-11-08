// How an IOU looks from the viewer's side, and which IOUs a payment can repay
// (IOU-1 to IOU-4). Pure functions over plain rows, so they can be tested
// without the phone's database; apps/mobile/src/lib/ious.ts loads the rows.

import { paise, type DateKey, type Paise } from '@money-plant/core';
import { outstanding, type Iou, type IouDirection, type IouPayment } from './ious';

/** The fields of a stored IOU row these functions read (LocalIou in db-schema). */
export interface IouRow {
  id: string;
  userId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerVpa: string | null;
  personAccountId: string;
  direction: IouDirection;
  amountPaise: number;
  /** INR when left out (decision 0017). */
  currency?: string;
  reason: string | null;
  occurredOn: string;
  dueDate: string | null;
  transactionId: string | null;
  counterpartyEmail: string | null;
  counterpartyPersonAccountId: string | null;
  counterpartyTransactionId: string | null;
  counterpartyVpa: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  response: 'accept' | 'decline' | null;
}

/**
 * Where an IOU stands between the two people (IOU-2). `personal`: only the
 * owner knows it. `awaiting_them`: shared, the other person hasn't answered.
 * `awaiting_me`: someone shared it with this user.
 */
export type IouState = 'personal' | 'awaiting_them' | 'awaiting_me' | 'confirmed' | 'declined';

export type IouRole = 'owner' | 'counterparty';

export interface IouView extends Iou {
  role: IouRole;
  state: IouState;
  /** This user's ledger entry for the loan. */
  transactionId: string | null;
  otherName: string;
  /** UPI ID to pay the other person (IOU-3). */
  otherVpa: string | null;
  /** The address the IOU is shared with, for the owner. */
  sharedWith: string | null;
  outstanding: Paise;
  /** The IOU's currency (decision 0017). */
  currency: string;
  payments: IouPayment[];
}

/** The viewer's own person account for the other side, as far as these functions need it. */
export interface IouPerson {
  name: string;
  vpa: string | null;
}

export function iouState(row: IouRow, role: IouRole): IouState {
  if (role === 'owner') {
    if (!row.counterpartyEmail) return 'personal';
    return row.declinedAt ? 'declined' : row.confirmedAt ? 'confirmed' : 'awaiting_them';
  }
  // An answer this phone gave but hasn't synced yet counts already.
  if (row.response) return row.response === 'accept' ? 'confirmed' : 'declined';
  return row.declinedAt ? 'declined' : row.confirmedAt ? 'confirmed' : 'awaiting_me';
}

/**
 * The IOU as `meId` sees it. The counterparty sees the direction flipped (the
 * owner lent, so they borrowed) and their own person account and entry.
 * `personOf` looks up the viewer's person account by id.
 */
export function iouView(
  row: IouRow,
  meId: string,
  personOf: (id: string) => IouPerson | undefined,
  payments: IouPayment[],
): IouView {
  const role: IouRole = row.userId === meId ? 'owner' : 'counterparty';
  const personId = role === 'owner' ? row.personAccountId : row.counterpartyPersonAccountId;
  const person = personId ? personOf(personId) : undefined;
  const base: Iou = {
    id: row.id,
    personId,
    direction: role === 'owner' ? row.direction : row.direction === 'lent' ? 'borrowed' : 'lent',
    amount: paise(row.amountPaise),
    reason: row.reason,
    occurredOn: row.occurredOn as DateKey,
    dueDate: row.dueDate as DateKey | null,
  };
  return {
    ...base,
    role,
    state: iouState(row, role),
    transactionId: role === 'owner' ? row.transactionId : row.counterpartyTransactionId,
    otherName: person?.name ?? (role === 'owner' ? 'Someone' : (row.ownerName ?? row.ownerEmail ?? 'A friend')),
    otherVpa: role === 'owner' ? (person?.vpa ?? row.counterpartyVpa) : (row.ownerVpa ?? person?.vpa ?? null),
    sharedWith: role === 'owner' ? row.counterpartyEmail : null,
    outstanding: outstanding(base, payments),
    currency: row.currency ?? 'INR',
    payments,
  };
}

/** A counterparty's declined IOUs are hidden from them; everything else shows. */
export const isVisibleIou = (view: Pick<IouView, 'role' | 'state'>) => !(view.role === 'counterparty' && view.state === 'declined');

/** Open IOUs that count toward balances: not declined, not waiting for this user's answer. */
export const isOpenIou = (v: Pick<IouView, 'outstanding' | 'personId' | 'state'>) =>
  v.outstanding > 0 && v.personId !== null && v.state !== 'declined' && v.state !== 'awaiting_me';

/** Money in repays what the user lent; money out repays what they borrowed. */
export const repaymentDirection = (ownAmount: number): IouDirection => (ownAmount > 0 ? 'lent' : 'borrowed');

/** A loan can't be repaid before it was made, or by the entry that made it. */
export const canRepay = (view: Pick<IouView, 'occurredOn' | 'transactionId'>, on: DateKey, transactionId: string) =>
  view.occurredOn <= on && view.transactionId !== transactionId;

export interface RepaymentOption {
  personId: string;
  name: string;
  /** What is still open with them in the entry's direction. */
  outstanding: Paise;
  /** True when the payee is this person by UPI ID, a linked name or the exact name. */
  likely: boolean;
}

/**
 * IOU-4 by hand: the people a payment of `amount` on `on` could repay, in
 * `direction`. Each has open IOUs from on or before that day, other than the
 * one the entry made, adding up to at least `amount`. `likelyId` (the person
 * the payee matches) comes first, then by name.
 */
export function repaymentOptionsFor(
  views: readonly IouView[],
  entry: { transactionId: string; on: DateKey; amount: Paise; direction: IouDirection },
  likelyId: string | null,
): RepaymentOption[] {
  const totals = new Map<string, { name: string; outstanding: number }>();
  for (const v of views) {
    if (!isOpenIou(v) || v.direction !== entry.direction || !canRepay(v, entry.on, entry.transactionId)) continue;
    const t = totals.get(v.personId!) ?? { name: v.otherName, outstanding: 0 };
    t.outstanding += v.outstanding;
    totals.set(v.personId!, t);
  }
  return [...totals]
    .filter(([, t]) => t.outstanding >= entry.amount)
    .map(([personId, t]) => ({ personId, name: t.name, outstanding: paise(t.outstanding), likely: personId === likelyId }))
    .sort((a, b) => Number(b.likely) - Number(a.likely) || a.name.localeCompare(b.name));
}

/**
 * For Review: the one person an entry probably repays when the payee's name
 * didn't match, because exactly one person has an open IOU of exactly that
 * amount in that direction. Null when none or several do.
 */
export function guessRepayment(
  views: readonly IouView[],
  entry: { transactionId: string; on: DateKey; ownAmount: number },
): { personId: string; name: string } | null {
  const direction = repaymentDirection(entry.ownAmount);
  const hits = views.filter(
    (v) => isOpenIou(v) && v.direction === direction && v.outstanding === Math.abs(entry.ownAmount) && canRepay(v, entry.on, entry.transactionId),
  );
  return new Set(hits.map((v) => v.personId)).size === 1 ? { personId: hits[0]!.personId!, name: hits[0]!.otherName } : null;
}
