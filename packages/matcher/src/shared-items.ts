import { paise, type CurrencyCode, type DateKey, type Paise } from '@money-plant/core';
import type { LedgerPosting } from './types';

/**
 * Decision 0026: what two people owe each other, as shared items. One row
 * both people read; each side's ledger records only its own money:
 *
 * - share: one paid for something the other owes part of. The person who
 *   owes gets spending plus "I owe" with no bank leg, so no account balance
 *   moves on their side.
 * - loan and repayment: money moved. Each side links its own bank entry (from
 *   SMS, a statement, or one it typed), whose person leg carries the item.
 */

export type ItemKind = 'share' | 'loan' | 'repayment';

/** From the viewer's side: value went to the other person ('to_them') or came to the viewer ('to_me'). */
export type ItemFlow = 'to_them' | 'to_me';

export interface SharedItem {
  id: string;
  kind: ItemKind;
  /** From the viewer's side (see viewerFlow). */
  flow: ItemFlow;
  amount: Paise;
  currency: CurrencyCode;
  occurredOn: DateKey;
  /** The other side's answer to a share; null while waiting or for loans and repayments. */
  answer: 'accepted' | 'declined' | null;
  /** True when the viewer created it. */
  mine: boolean;
  /** One-sided: the other person isn't on Money Plant (or not linked as a friend). */
  oneSided: boolean;
}

/** The creator's flow seen from the other side is the opposite. */
export const viewerFlow = (creatorFlow: ItemFlow, viewerIsCreator: boolean): ItemFlow =>
  viewerIsCreator ? creatorFlow : creatorFlow === 'to_them' ? 'to_me' : 'to_them';

/** Whether an item counts towards what is owed: a declined share doesn't, and one still waiting does for its creator only. */
export function counts(item: Pick<SharedItem, 'kind' | 'answer' | 'mine' | 'oneSided'>): boolean {
  if (item.kind !== 'share') return true;
  if (item.answer === 'declined') return false;
  return item.mine || item.oneSided || item.answer === 'accepted';
}

/**
 * What the other person owes the viewer, per currency: above zero they owe
 * the viewer, below zero the viewer owes them. Both phones get the same
 * number (with the sign flipped), because it comes from the shared rows.
 */
export function sharedBalance(items: readonly Pick<SharedItem, 'kind' | 'flow' | 'amount' | 'currency' | 'answer' | 'mine' | 'oneSided'>[]): Map<CurrencyCode, Paise> {
  const out = new Map<CurrencyCode, number>();
  for (const item of items) {
    if (!counts(item)) continue;
    const signed = item.flow === 'to_them' ? item.amount : -item.amount;
    out.set(item.currency, (out.get(item.currency) ?? 0) + signed);
  }
  return new Map([...out].filter(([, v]) => v !== 0).map(([c, v]) => [c, paise(v)]));
}

/** The person leg an item puts on the viewer's ledger: positive when they owe the viewer. */
export const personLegAmount = (item: Pick<SharedItem, 'flow' | 'amount'>): Paise => paise(item.flow === 'to_them' ? item.amount : -item.amount);

/**
 * The entry the viewer's phone makes for a share where value came to them
 * and no money moved through their accounts: their part is spending on the
 * category, owed to the person. Sums to zero. Never touches a bank account,
 * which is the mistake decision 0026 fixes.
 */
export function shareEntryPostings(
  item: Pick<SharedItem, 'kind' | 'flow' | 'amount' | 'currency'>,
  categoryId: string,
  personId: string,
  newId: () => string,
): LedgerPosting[] {
  if (item.kind !== 'share' || item.flow !== 'to_me') throw new Error('Only a share paid by the other person makes an entry of its own');
  const currency = { currency: item.currency };
  return [
    { id: newId(), accountId: categoryId, amount: item.amount, ...currency },
    { id: newId(), accountId: personId, amount: paise(-item.amount), ...currency },
  ];
}

/**
 * Links an item to one of the viewer's own entries: `amount` of the entry's
 * other legs (its category, or Uncategorised) moves to the person. Splitting
 * a ₹1,000 bank payment with a ₹600 share leaves ₹400 on Food and ₹600 owed;
 * a ₹500 loan sent by UPI becomes ₹500 owed. The own legs never change, so
 * the account balance stays what the bank says.
 *
 * `ownAccountIds` are the viewer's own accounts (bank, card, wallet, cash).
 * Throws when the entry's direction doesn't fit the item or it is too small.
 */
export function linkPostings(
  postings: readonly LedgerPosting[],
  ownAccountIds: ReadonlySet<string>,
  item: Pick<SharedItem, 'flow' | 'amount' | 'currency'>,
  personId: string,
  newId: () => string,
): LedgerPosting[] {
  const inCurrency = (p: LedgerPosting) => (p.currency ?? 'INR') === item.currency;
  const own = postings.filter((p) => ownAccountIds.has(p.accountId) && inCurrency(p));
  const ownTotal = own.reduce((s, p) => s + p.amount, 0);
  // Value to them: money left the viewer's accounts. Value to the viewer: money came in.
  if (item.flow === 'to_them' ? ownTotal >= 0 : ownTotal <= 0) throw new Error("This entry's money goes the other way");
  if (Math.abs(ownTotal) < item.amount) throw new Error('This entry is smaller than the amount');
  const want = personLegAmount(item);
  // Take from the other legs with the same sign as the person leg, largest first.
  const others = postings
    .filter((p) => !ownAccountIds.has(p.accountId) && p.accountId !== personId && inCurrency(p) && Math.sign(p.amount) === Math.sign(want))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  let left = Math.abs(want);
  const taken = new Map<string, number>();
  for (const p of others) {
    if (left <= 0) break;
    const take = Math.min(left, Math.abs(p.amount));
    taken.set(p.id, take);
    left -= take;
  }
  if (left > 0) throw new Error('Not enough of this entry is left to link');
  const out: LedgerPosting[] = [];
  for (const p of postings) {
    const take = taken.get(p.id);
    if (take === undefined) {
      out.push(p);
      continue;
    }
    const rest = Math.abs(p.amount) - take;
    if (rest > 0) out.push({ ...p, amount: paise(Math.sign(p.amount) * rest) });
  }
  const existing = out.find((p) => p.accountId === personId && inCurrency(p));
  if (existing) existing.amount = paise(existing.amount + want);
  else out.push({ id: newId(), accountId: personId, amount: want, currency: item.currency });
  return out.filter((p) => p.amount !== 0);
}

/**
 * Undoes a link: the person's part goes back to `fallbackId` (the category it
 * came from, or Uncategorised). The own legs never change.
 */
export function unlinkPostings(
  postings: readonly LedgerPosting[],
  item: Pick<SharedItem, 'flow' | 'amount' | 'currency'>,
  personId: string,
  fallbackId: string,
  newId: () => string,
): LedgerPosting[] {
  const want = personLegAmount(item);
  const out = postings.map((p) => ({ ...p }));
  const leg = out.find((p) => p.accountId === personId && (p.currency ?? 'INR') === item.currency);
  if (!leg) return out;
  leg.amount = paise(leg.amount - want);
  const back = out.find((p) => p.accountId === fallbackId && (p.currency ?? 'INR') === item.currency);
  if (back) back.amount = paise(back.amount + want);
  else out.push({ id: newId(), accountId: fallbackId, amount: want, currency: item.currency });
  return out.filter((p) => p.amount !== 0);
}

/** One of the viewer's entries that could be their side of a loan or repayment. */
export interface CandidateEntry {
  id: string;
  /** "2026-11-13". */
  day: DateKey;
  /** Sum of the viewer's own account legs, signed: below zero money went out. */
  ownAmount: Paise;
  currency: CurrencyCode;
  /** Already linked to another item, or already carrying a person leg. */
  taken: boolean;
  /** The payee on the entry is this person, by their identifiers (decision 0025). */
  payeeIsPerson: boolean;
}

const dayNumber = (d: DateKey) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * The viewer's own entries that could be their side of a loan or repayment:
 * money in the right direction, for exactly the amount, within `days` of the
 * item. The payee being the person by their identifiers comes first, then the
 * closest day. A share needs no bank entry on the side value came to.
 */
export function counterpartCandidates<T extends CandidateEntry>(
  entries: readonly T[],
  item: Pick<SharedItem, 'kind' | 'flow' | 'amount' | 'currency' | 'occurredOn'>,
  days = 3,
): T[] {
  if (item.kind === 'share' && item.flow === 'to_me') return [];
  const sign = item.flow === 'to_them' ? -1 : 1;
  const day = dayNumber(item.occurredOn);
  return entries
    .filter(
      (e) =>
        !e.taken &&
        e.currency === item.currency &&
        Math.sign(e.ownAmount) === sign &&
        (item.kind === 'share' ? Math.abs(e.ownAmount) >= item.amount : Math.abs(e.ownAmount) === item.amount) &&
        Math.abs(dayNumber(e.day) - day) <= days,
    )
    .sort((a, b) => Number(b.payeeIsPerson) - Number(a.payeeIsPerson) || Math.abs(dayNumber(a.day) - day) - Math.abs(dayNumber(b.day) - day));
}

export type ItemStatus =
  /** Done on this side. */
  | 'linked'
  /** A loan, repayment, or share paid by the viewer that has no entry of the viewer's yet. */
  | 'needs_link'
  /** A share waiting for the viewer to accept or decline. */
  | 'needs_answer'
  /** The viewer's share waiting for the other person. */
  | 'waiting'
  | 'declined';

/** Where an item stands on the viewer's side, given whether the viewer has linked an entry to it. */
export function itemStatus(item: Pick<SharedItem, 'kind' | 'answer' | 'mine' | 'oneSided'>, linked: boolean): ItemStatus {
  if (item.kind === 'share' && item.answer === 'declined') return 'declined';
  if (item.kind === 'share' && !item.mine && item.answer === null) return 'needs_answer';
  if (!linked) return 'needs_link';
  if (item.kind === 'share' && item.mine && !item.oneSided && item.answer === null) return 'waiting';
  return 'linked';
}

/**
 * The ledger and the shared rows should agree: what the person's account
 * holds from linked items equals the shared balance. A difference means an
 * item isn't linked on this side yet (or an entry was changed by hand).
 */
export function ledgerGap(shared: ReadonlyMap<CurrencyCode, Paise>, ledger: ReadonlyMap<CurrencyCode, Paise>): Map<CurrencyCode, Paise> {
  const out = new Map<CurrencyCode, Paise>();
  for (const c of new Set([...shared.keys(), ...ledger.keys()])) {
    const gap = (shared.get(c) ?? 0) - (ledger.get(c) ?? 0);
    if (gap !== 0) out.set(c, paise(gap));
  }
  return out;
}
