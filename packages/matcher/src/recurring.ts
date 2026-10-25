import {
  CADENCE_DAYS,
  daysBetween,
  dateOf,
  nextOccurrence,
  type Cadence,
  type DateKey,
  type Paise,
} from '@money-plant/core';
import { normaliseMerchant } from '@money-plant/categoriser';
import type { ParsedPreDebit, ParsedTransaction } from '@money-plant/parser';
import type { LedgerTransaction } from './types';

/** A recurring payment the user tracks: an autopay, EMI, rent or subscription (REC-1 to REC-4). */
export interface RecurringPayment {
  id: string;
  /** What the user calls it, "Netflix". */
  name: string;
  /** Payee UPI ID; a debit to it is this payment. */
  vpa: string | null;
  /** Normalised merchant name (normaliseMerchant); a debit whose payee matches it is this payment. */
  merchant: string | null;
  /** Expected amount. A debit within AMOUNT_TOLERANCE of it counts. */
  amount: Paise;
  cadence: Cadence;
  /** Day of the month it is due, for monthly and longer cadences. */
  anchorDay: number | null;
  nextDue: DateKey;
  /** The account or card it is paid from, when known; used for the "might be short" warning. */
  accountId: string | null;
  categoryId: string | null;
  /** proposed: detected and waiting for the user. declined: the user said no, so it isn't proposed again. */
  status: 'active' | 'paused' | 'proposed' | 'declined';
  origin: 'manual' | 'history' | 'pre_debit';
  mandateRef: string | null;
  /** When the last occurrence was paid, and the entry that paid it (REC-4). */
  lastPaidAt: string | null;
  lastTransactionId: string | null;
}

/** Matching rule "Recurring match": within 3 days of the due date and 10% of the amount. */
export const DUE_WINDOW_DAYS = 3;
export const AMOUNT_TOLERANCE = 0.1;

/** A debit from one of the user's accounts, as recurring detection and matching see it. */
export interface Debit {
  transactionId: string;
  occurredAt: string;
  /** Positive. */
  amount: Paise;
  /** Payee as shown on the entry. */
  label: string | null;
  vpa: string | null;
  merchant: string | null;
  accountId: string;
  categoryId: string | null;
}

/**
 * Reads a spending entry as a debit: two postings, money leaving one of the
 * user's accounts. Transfers, splits and income are not recurring payments.
 */
export function debitOf(tx: LedgerTransaction, isOwned: (accountId: string) => boolean): Debit | null {
  if (tx.kind !== 'expense' || tx.postings.length !== 2) return null;
  const own = tx.postings.find((p) => isOwned(p.accountId));
  const other = tx.postings.find((p) => !isOwned(p.accountId));
  if (!own || !other || own.amount >= 0) return null;
  const sms = tx.sources.find((s) => s.kind === 'sms')?.parsedFields as Partial<ParsedTransaction> | undefined;
  const vpa = sms?.vpa ?? null;
  return {
    transactionId: tx.id,
    occurredAt: tx.occurredAt,
    amount: -own.amount as Paise,
    label: tx.counterparty,
    vpa,
    merchant: tx.counterparty ? normaliseMerchant(tx.counterparty) : vpa ? normaliseMerchant(vpa) : null,
    accountId: own.accountId,
    categoryId: other.accountId,
  };
}

export function amountClose(expected: Paise, actual: Paise): boolean {
  return Math.abs(actual - expected) <= expected * AMOUNT_TOLERANCE;
}

/** "netflix" matches "netflix com" (whole words); very short names must match exactly. */
function namesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `);
}

export function payeeMatches(item: Pick<RecurringPayment, 'vpa' | 'merchant'>, debit: Pick<Debit, 'vpa' | 'merchant'>): boolean {
  if (item.vpa && debit.vpa) return item.vpa === debit.vpa;
  return item.merchant !== null && debit.merchant !== null && namesMatch(item.merchant, debit.merchant);
}

export interface Settlement {
  item: RecurringPayment;
  /** Debits that paid an occurrence, oldest first. */
  paid: Debit[];
}

/** A debit within ₹1 of the amount counts as this payment even when its payee is printed differently. */
export const EXACT_AMOUNT_TOLERANCE = 100;

/**
 * REC-4: marks occurrences paid from matching debits and moves the due date
 * forward, as many times as debits allow (an import may cover several months).
 * A debit matches by payee, or, when no debit's payee matches, as the only
 * debit of the same amount (within ₹1) from the payment's own account inside
 * the due window: banks often print an autopay's payee differently on the
 * notice and on the debit. Debits in `taken` (paid another payment already)
 * are skipped, and the ones used here are added to it.
 * Idempotent: a debit at or before the last paid one is never used again.
 */
export function settleRecurring(item: RecurringPayment, debits: readonly Debit[], taken: Set<string> = new Set()): Settlement {
  if (item.status !== 'active') return { item, paid: [] };
  let next = item;
  const paid: Debit[] = [];
  for (;;) {
    const open = debits.filter(
      (d) =>
        !taken.has(d.transactionId) &&
        d.transactionId !== next.lastTransactionId &&
        (next.lastPaidAt === null || Date.parse(d.occurredAt) > Date.parse(next.lastPaidAt)) &&
        Math.abs(daysBetween(next.nextDue, dateOf(d.occurredAt))) <= DUE_WINDOW_DAYS,
    );
    let candidates = open.filter((d) => amountClose(next.amount, d.amount) && payeeMatches(next, d));
    if (candidates.length === 0 && next.accountId !== null) {
      const same = open.filter((d) => d.accountId === next.accountId && Math.abs(d.amount - next.amount) <= EXACT_AMOUNT_TOLERANCE);
      if (same.length === 1) candidates = same;
    }
    if (candidates.length === 0) return { item: next, paid };
    const best = candidates.reduce((a, b) =>
      Math.abs(daysBetween(next.nextDue, dateOf(b.occurredAt))) < Math.abs(daysBetween(next.nextDue, dateOf(a.occurredAt))) ? b : a,
    );
    taken.add(best.transactionId);
    paid.push(best);
    next = {
      ...next,
      nextDue: nextOccurrence(next.nextDue, next.cadence, next.anchorDay),
      lastPaidAt: best.occurredAt,
      lastTransactionId: best.transactionId,
    };
  }
}

/** Gap bands, in days, that count as each cadence, and how many payments it takes to believe it. */
const BANDS: readonly { cadence: Cadence; min: number; max: number; count: number }[] = [
  { cadence: 'weekly', min: 5, max: 9, count: 4 },
  { cadence: 'monthly', min: 25, max: 35, count: 3 },
  { cadence: 'quarterly', min: 80, max: 100, count: 3 },
];

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

export type RecurringProposal = Omit<RecurringPayment, 'id' | 'status' | 'origin' | 'mandateRef'>;

/**
 * REC-1: finds payees paid on a steady rhythm for a steady amount, such as a
 * subscription, rent or an EMI. Every gap between payments must fit one
 * cadence, so a merchant paid at random (Swiggy, Amazon) never qualifies.
 * Payees that `known` already covers, in any status, are skipped.
 */
export function detectRecurring(
  debits: readonly Debit[],
  known: readonly Pick<RecurringPayment, 'vpa' | 'merchant'>[],
  today: DateKey,
): RecurringProposal[] {
  const groups = new Map<string, Debit[]>();
  for (const debit of debits) {
    const key = debit.vpa ?? debit.merchant;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), debit]);
  }
  const proposals: RecurringProposal[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const last = sorted[sorted.length - 1]!;
    if (known.some((item) => payeeMatches(item, last))) continue;
    const dates = sorted.map((d) => dateOf(d.occurredAt));
    const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i]!, date));
    const band = BANDS.find((b) => sorted.length >= b.count && gaps.every((gap) => gap >= b.min && gap <= b.max));
    if (!band) continue;
    const typical = median(sorted.map((d) => d.amount)) as Paise;
    if (!sorted.every((d) => amountClose(typical, d.amount))) continue;
    // Still running: the last payment is no more than one and a half periods ago.
    if (daysBetween(dates[dates.length - 1]!, today) > CADENCE_DAYS[band.cadence] * 1.5) continue;
    const anchorDay = band.cadence === 'weekly' ? null : median(dates.map((d) => Number(d.slice(8))));
    let nextDue = nextOccurrence(dates[dates.length - 1]!, band.cadence, anchorDay);
    while (daysBetween(nextDue, today) > DUE_WINDOW_DAYS) nextDue = nextOccurrence(nextDue, band.cadence, anchorDay);
    proposals.push({
      name: last.label ?? last.vpa ?? 'Recurring payment',
      vpa: last.vpa,
      merchant: last.merchant,
      amount: last.amount,
      cadence: band.cadence,
      anchorDay,
      nextDue,
      accountId: last.accountId,
      categoryId: last.categoryId,
      lastPaidAt: last.occurredAt,
      lastTransactionId: last.transactionId,
    });
  }
  return proposals;
}

/**
 * REC-1: a pre-debit notice updates the matching recurring payment's due date
 * and amount, or describes a new one. The bank sends one for every mandate
 * debit, so a new one starts active, as a monthly guess the user can change.
 */
export function applyPreDebit(
  items: readonly RecurringPayment[],
  notice: ParsedPreDebit,
  accountId: string | null,
): { update: RecurringPayment } | { create: Omit<RecurringPayment, 'id'> } | null {
  const merchant = notice.payee ? normaliseMerchant(notice.payee) : null;
  const live = items.filter((item) => item.status !== 'declined');
  const match =
    (notice.mandateRef ? live.find((item) => item.mandateRef === notice.mandateRef) : undefined) ??
    (merchant ? live.find((item) => payeeMatches(item, { vpa: null, merchant })) : undefined) ??
    // No payee printed: the same account and amount is the best guess.
    (merchant === null && accountId !== null
      ? live.find((item) => item.accountId === accountId && amountClose(item.amount, notice.amount))
      : undefined);
  if (match) {
    // An occurrence already paid on or after this date means the notice is about one we've seen.
    if (match.lastPaidAt && dateOf(match.lastPaidAt) >= notice.dueDate) return null;
    return {
      update: {
        ...match,
        nextDue: notice.dueDate,
        amount: notice.amount,
        mandateRef: match.mandateRef ?? notice.mandateRef,
        accountId: match.accountId ?? accountId,
        // The bank confirmed it is live; a suggestion becomes a tracked payment.
        status: match.status === 'proposed' ? 'active' : match.status,
      },
    };
  }
  if (!notice.payee && !notice.mandateRef) return null;
  return {
    create: {
      name: notice.payee ?? 'Autopay',
      vpa: null,
      merchant,
      amount: notice.amount,
      cadence: 'monthly',
      anchorDay: Number(notice.dueDate.slice(8)),
      nextDue: notice.dueDate,
      accountId,
      categoryId: null,
      status: 'active',
      origin: 'pre_debit',
      mandateRef: notice.mandateRef,
      lastPaidAt: null,
      lastTransactionId: null,
    },
  };
}

/** Where a payment stands on `today`, for lists and reminders. */
export function dueState(item: Pick<RecurringPayment, 'nextDue'>, today: DateKey): { days: number; overdue: boolean } {
  const days = daysBetween(today, item.nextDue);
  return { days, overdue: days < -DUE_WINDOW_DAYS };
}

/**
 * REC-3: how much an account would be short when this payment is due, counting
 * every active payment due from the same account up to that day. Null when
 * the balance covers it, or the account is a card or loan (no balance to run out).
 */
export function shortfall(
  item: Pick<RecurringPayment, 'id' | 'accountId' | 'nextDue'>,
  items: readonly Pick<RecurringPayment, 'id' | 'accountId' | 'nextDue' | 'amount' | 'status'>[],
  account: { balance: Paise; liability: boolean } | undefined,
): Paise | null {
  if (!item.accountId || !account || account.liability) return null;
  const due = items
    .filter((other) => other.status === 'active' && other.accountId === item.accountId && other.nextDue <= item.nextDue)
    .reduce((sum, other) => sum + other.amount, 0);
  return account.balance < due ? ((due - account.balance) as Paise) : null;
}
