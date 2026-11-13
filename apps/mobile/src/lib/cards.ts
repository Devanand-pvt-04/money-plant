import * as Crypto from 'expo-crypto';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  addDays,
  billStatus,
  dateKey,
  dateOf,
  daysBetween,
  dueDateFor,
  lastStatementDate,
  nextStatementDate,
  paise,
  RECONCILE_TOLERANCE,
  startOfDate,
  statementDateFor,
  statementEnd,
  type BillStatus,
  type CardBill,
  type DateKey,
  type Paise,
} from '@money-plant/core';
import { accounts, balanceAnchors, postings, sources, transactions } from '@money-plant/db-schema';
import { cardBalance, digitsMatch, institutionBank, rebaseOpening, type LedgerTransaction } from '@money-plant/matcher';
import type { ParsedCardStatement } from '@money-plant/parser';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { kvGet, kvSet } from './kv';
import { listAccountBalances, type AccountBalance } from './ledger';
import { SqliteLedgerStore } from './ledger-store';

const DAY = 24 * 60 * 60 * 1000;
/** A first credit limit turns card SMS from about one billing cycle back into balance checks. */
export const LIMIT_LOOKBACK_DAYS = 45;
/** Pending authorisations hold limit for a day or two, so a card's gap waits this long before Review shows it. */
export const CARD_GAP_WAIT_DAYS = 3;

/**
 * Decision 0024: sets a credit card's limit (null clears it). Card SMS from
 * `from` on that printed an available limit become balance checks with it,
 * and checks already made from them are worked out again. A first limit
 * looks back one billing cycle; a limit change starts where it changed.
 */
export async function setCreditLimit(accountId: string, limit: Paise | null, from?: string): Promise<void> {
  const db = await getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || account.type !== 'credit_card') throw new Error('Not a credit card');
  const since = from ?? new Date(Date.now() - LIMIT_LOOKBACK_DAYS * DAY).toISOString();
  db.update(accounts)
    .set({ creditLimitPaise: limit, dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, accountId))
    .run();

  // The card's SMS with an available limit: sources of entries that post to the card.
  const rows = db
    .select({ id: sources.id, receivedAt: sources.receivedAt, parsedFields: sources.parsedFields })
    .from(sources)
    .innerJoin(transactions, eq(transactions.id, sources.transactionId))
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .where(and(eq(postings.accountId, accountId), eq(sources.kind, 'sms'), isNull(transactions.deletedAt), gte(sources.receivedAt, since)))
    .all();
  const seen = new Set<string>();
  const existing = new Map(
    db
      .select()
      .from(balanceAnchors)
      .where(and(eq(balanceAnchors.accountId, accountId), isNull(balanceAnchors.deletedAt)))
      .all()
      .map((a) => [a.sourceId, a]),
  );
  const now = new Date().toISOString();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const fields = JSON.parse(row.parsedFields) as { availableLimit?: unknown; accountLast?: unknown };
    // Only this card's own messages: a bank's debit for its bill has no available limit.
    if (typeof fields.availableLimit !== 'number') continue;
    if (account.last4 && typeof fields.accountLast === 'string' && !account.last4.endsWith(fields.accountLast) && !fields.accountLast.endsWith(account.last4)) continue;
    const balance = limit === null ? null : cardBalance(limit, paise(fields.availableLimit));
    const anchor = existing.get(row.id);
    if (anchor && balance === null) {
      db.update(balanceAnchors).set({ deletedAt: now, dirty: 1, rev: sql`${balanceAnchors.rev} + 1` }).where(eq(balanceAnchors.id, anchor.id)).run();
    } else if (anchor && balance !== null && anchor.balancePaise !== balance) {
      db.update(balanceAnchors).set({ balancePaise: balance, dirty: 1, rev: sql`${balanceAnchors.rev} + 1` }).where(eq(balanceAnchors.id, anchor.id)).run();
    } else if (!anchor && balance !== null) {
      db.insert(balanceAnchors)
        .values({ id: Crypto.randomUUID(), accountId, balancePaise: balance, observedAt: row.receivedAt, sourceId: row.id, createdAt: now, dirty: 1 })
        .run();
    }
  }

  // Like SMS anchors: the earliest one is the reference, unless the user set the balance.
  const store = new SqliteLedgerStore(db);
  const ref = await store.getBalanceRef(accountId);
  if (!ref || ref.kind === 'anchor') {
    const earliest = db
      .select()
      .from(balanceAnchors)
      .where(and(eq(balanceAnchors.accountId, accountId), isNull(balanceAnchors.deletedAt)))
      .orderBy(asc(balanceAnchors.observedAt), asc(balanceAnchors.createdAt))
      .get();
    if (earliest) await store.setBalanceRef(accountId, { kind: 'anchor', balance: paise(earliest.balancePaise), at: earliest.observedAt });
  }
  await rebaseOpening(store, accountId);
  notifyLedgerChange();
}

/**
 * Decision 0024, choice 2: one entry for money the ledger missed, so the
 * account matches what the bank or card says. Money out on a card is
 * "Unrecorded card spending" and counts in budgets as uncategorised.
 * `gap` is the bank's balance minus the ledger's: negative means money out.
 */
export async function recordUnrecorded(accountId: string, gap: Paise, occurredAt: string): Promise<void> {
  if (gap === 0) return;
  const db = await getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error('Account not found');
  const store = new SqliteLedgerStore(db);
  const out = gap < 0;
  const other = await store.systemAccount(out ? 'uncategorised_expense' : 'uncategorised_income');
  const counterparty = out ? (account.type === 'credit_card' ? 'Unrecorded card spending' : 'Unrecorded spending') : 'Unrecorded money in';
  const amount = paise(Math.abs(gap));
  const tx: LedgerTransaction = {
    id: Crypto.randomUUID(),
    occurredAt,
    counterparty,
    kind: out ? 'expense' : 'income',
    status: 'confirmed',
    confidence: 1,
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: [],
    note: null,
    postings: [
      { id: Crypto.randomUUID(), accountId, amount: gap },
      { id: Crypto.randomUUID(), accountId: other.id, amount: paise(-gap) },
    ],
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'manual',
        sender: null,
        externalRef: null,
        fingerprint: `balance-gap|${accountId}|${occurredAt}|${gap}`,
        parsedFields: { direction: out ? 'debit' : 'credit', amount, counterparty, balanceGap: true },
        receivedAt: new Date().toISOString(),
        confidence: 1,
        rawText: null,
      },
    ],
  };
  await store.saveTransaction(tx);
  await rebaseOpening(store, accountId);
  notifyLedgerChange();
}

/** Whether Review shows an account's balance gap now: a card's gap waits a few days (decision 0024). */
export function gapIsDue(balance: AccountBalance, now = Date.now()): boolean {
  const r = balance.reconciliation;
  if (!r?.flagged) return false;
  if (balance.account.type !== 'credit_card') return true;
  return r.gapSince !== null && now - Date.parse(r.gapSince) >= CARD_GAP_WAIT_DAYS * DAY;
}

/** A credit card that shows money in its favour without any balance from the card to back it. */
export interface CardInCredit {
  balance: AccountBalance;
  /** The latest payment into the card: unrecorded spending happened before it. */
  paidAt: string | null;
}

const ACCEPTED = (accountId: string) => `cards.inCredit.${accountId}`;

/**
 * Decision 0024: a bill payment that takes a card above zero usually means
 * spends the app never saw. Cards whose own SMS check the balance are left
 * to the gap check; one the user said really is in credit stays quiet until
 * its balance changes.
 */
export async function cardsInCredit(balances?: AccountBalance[]): Promise<CardInCredit[]> {
  const all = balances ?? (await listAccountBalances());
  const cards = all.filter((b) => b.account.type === 'credit_card' && b.balance > RECONCILE_TOLERANCE && !b.reconciliation);
  if (cards.length === 0) return [];
  const db = await getDb();
  const result: CardInCredit[] = [];
  for (const card of cards) {
    if ((await kvGet(ACCEPTED(card.account.id))) === String(card.balance)) continue;
    const paid = db
      .select({ occurredAt: transactions.occurredAt })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(eq(postings.accountId, card.account.id), isNull(transactions.deletedAt), sql`${postings.amountPaise} > 0`))
      .orderBy(sql`${transactions.occurredAt} desc`)
      .get();
    result.push({ balance: card, paidAt: paid?.occurredAt ?? null });
  }
  return result;
}

/** "The card really is in credit": not asked again until its balance changes. */
export async function acceptCardCredit(card: AccountBalance): Promise<void> {
  await kvSet(ACCEPTED(card.account.id), String(card.balance));
  notifyLedgerChange();
}

/** Unrecorded spending happened before the payment that showed it up. */
export function beforePayment(paidAt: string | null): string {
  return new Date((paidAt ? Date.parse(paidAt) : Date.now()) - 1000).toISOString();
}

/** Decision 0024: what the latest bill says, and how this cycle is going. */
export interface CardCycle {
  bill: (CardBill & { status: BillStatus }) | null;
  /** Spending on the card since the last statement date; null when no statement day is known. */
  cycleSpend: Paise | null;
  cycleStart: DateKey | null;
  nextStatement: DateKey | null;
}

export async function cardCycle(accountId: string, today: DateKey = dateKey(new Date())): Promise<CardCycle> {
  const db = await getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || account.type !== 'credit_card') return { bill: null, cycleSpend: null, cycleStart: null, nextStatement: null };
  const sumSince = (fromIso: string, sign: 'in' | 'out', kinds?: string[]) =>
    paise(
      Math.abs(
        db
          .select({ total: sql<number>`coalesce(sum(${postings.amountPaise}), 0)` })
          .from(postings)
          .innerJoin(transactions, eq(transactions.id, postings.transactionId))
          .where(
            and(
              eq(postings.accountId, accountId),
              isNull(transactions.deletedAt),
              sql`${transactions.occurredAt} > ${fromIso}`,
              sign === 'in' ? sql`${postings.amountPaise} > 0` : sql`${postings.amountPaise} < 0`,
              ...(kinds ? [inArray(transactions.kind, kinds as ('expense' | 'transfer')[])] : []),
            ),
          )
          .get()?.total ?? 0,
      ),
    );
  let bill: CardCycle['bill'] = null;
  if (account.billStatementOn && account.billTotalPaise !== null) {
    const base: CardBill = {
      statementOn: account.billStatementOn,
      dueOn: account.billDueOn,
      total: paise(account.billTotalPaise),
      minimum: account.billMinimumPaise === null ? null : paise(account.billMinimumPaise),
    };
    // Payments are transfers into the card; refunds don't pay a bill.
    bill = { ...base, status: billStatus(base, sumSince(statementEnd(base.statementOn), 'in', ['transfer']), today) };
  }
  const statementDay = account.statementDay;
  const cycleStart = statementDay !== null ? lastStatementDate(today, statementDay) : null;
  return {
    bill,
    cycleStart,
    cycleSpend: cycleStart ? sumSince(statementEnd(cycleStart), 'out', ['expense']) : null,
    nextStatement: statementDay !== null ? nextStatementDate(today, statementDay) : null,
  };
}

/**
 * Decision 0024: a statement or bill-due SMS updates the card's latest bill
 * and teaches the app its billing cycle. Only the newest statement counts,
 * so reading an old inbox in any order ends on the right bill. A reminder
 * only fills in what the current bill is missing. False when no card fits.
 */
export async function applyCardStatement(statement: ParsedCardStatement, receivedAt: string): Promise<boolean> {
  const db = await getDb();
  const cards = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.type, 'credit_card'), isNull(accounts.deletedAt)))
    .all();
  const byDigits = statement.last4 ? cards.filter((c) => c.last4 !== null && digitsMatch(c.last4, statement.last4!)) : [];
  const ofBank = statement.bank ? cards.filter((c) => institutionBank(c.institution) === statement.bank) : [];
  const card = byDigits.length === 1 ? byDigits[0] : byDigits.length === 0 && !statement.last4 && ofBank.length === 1 ? ofBank[0] : undefined;
  if (!card) return false;

  const received = dateOf(receivedAt);
  let changes: Partial<typeof accounts.$inferInsert>;
  if (statement.kind === 'statement') {
    const statementOn = statementDateFor(received, statement.statementDate, card.statementDay);
    if (card.billStatementOn && card.billStatementOn > statementOn) return true;
    const dueOn = dueDateFor(statementOn, statement.dueDate, card.dueDays);
    const learnedDays = statement.dueDate ? daysBetween(statementOn, statement.dueDate) : null;
    changes = {
      statementDay: startOfDate(statementOn).getDate(),
      dueDays: learnedDays !== null && learnedDays >= 0 && learnedDays <= 60 ? learnedDays : card.dueDays,
      billStatementOn: statementOn,
      billDueOn: dueOn,
      billTotalPaise: statement.totalDue,
      billMinimumPaise: statement.minimumDue,
    };
  } else {
    // A reminder for the bill the app already has: it may say when it's due.
    if (!card.billStatementOn || received < card.billStatementOn || card.billDueOn) return true;
    changes = { billDueOn: statement.dueDate, ...(card.billMinimumPaise === null ? { billMinimumPaise: statement.minimumDue } : {}) };
  }
  db.update(accounts)
    .set({ ...changes, dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, card.id))
    .run();
  notifyLedgerChange();
  return true;
}

/** The user's billing cycle: the statement day and how many days later the bill is due. */
export async function setBillingCycle(accountId: string, statementDay: number | null, dueDays: number | null): Promise<void> {
  const db = await getDb();
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account || account.type !== 'credit_card') throw new Error('Not a credit card');
  if (statementDay !== null && (!Number.isInteger(statementDay) || statementDay < 1 || statementDay > 31)) throw new Error('The statement day is 1 to 31');
  if (dueDays !== null && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 60)) throw new Error('Days to pay is 0 to 60');
  const dueOn = account.billStatementOn && !account.billDueOn && dueDays !== null ? addDays(account.billStatementOn, dueDays) : account.billDueOn;
  db.update(accounts)
    .set({ statementDay, dueDays, billDueOn: dueOn, dirty: 1, rev: sql`${accounts.rev} + 1` })
    .where(eq(accounts.id, accountId))
    .run();
  notifyLedgerChange();
}

/** HOME-1: card bills still due in the next week, or overdue. */
export async function cardBillsDue(today: DateKey = dateKey(new Date())): Promise<{ account: typeof accounts.$inferSelect; status: BillStatus; bill: CardBill }[]> {
  const db = await getDb();
  const cards = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.type, 'credit_card'), isNull(accounts.deletedAt)))
    .all()
    .filter((c) => c.billDueOn !== null && c.billTotalPaise !== null && c.billTotalPaise > 0);
  const result = [];
  for (const account of cards) {
    const cycle = await cardCycle(account.id, today);
    if (!cycle.bill || cycle.bill.status.cleared || cycle.bill.status.daysLeft === null) continue;
    // Overdue bills keep showing for a month; after that a new statement takes over.
    if (cycle.bill.status.daysLeft > 6 || cycle.bill.status.daysLeft < -30) continue;
    result.push({ account, status: cycle.bill.status, bill: cycle.bill });
  }
  return result;
}
