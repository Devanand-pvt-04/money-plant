import { validatePostings, type AccountType, type Paise } from '@money-plant/core';
import type { CategoryDecision, PayeeKind } from '@money-plant/categoriser';
import type { CardBill, Direction, ParsedNotification, ParsedStatementRow, ParsedTransaction } from '@money-plant/parser';
import { digitsMatch, looksLikePerson, resolveAccount } from './accounts';
import { findRefunded, REFUND_WINDOW_DAYS } from './refunds';
import type {
  LedgerAccount,
  LedgerPosting,
  LedgerSource,
  LedgerStore,
  LedgerTransaction,
  ReviewReason,
} from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Same account, amount and direction this close together is one payment seen twice. */
export const DUPLICATE_WINDOW = 10 * MINUTE;
export const TRANSFER_WINDOW = 24 * HOUR;
/** Card bills can take a few days to show up on the card. */
export const CARD_PAYMENT_WINDOW = 3 * 24 * HOUR;
/** Below this, an entry waits in the review inbox. */
export const CONFIRM_THRESHOLD = 0.8;

/** What the pipeline tells the categoriser about a new entry. Amount is positive. */
export interface CategoriseRequest {
  direction: Direction;
  amount: Paise;
  counterparty: string | null;
  vpa: string | null;
  accountId: string;
  occurredAt: string;
  payeeKind: PayeeKind;
}

export interface PipelineContext {
  store: LedgerStore;
  newId: () => string;
  /**
   * Step 3 of the capture pipeline: user rules, learned patterns, then the
   * merchant dictionary (CAT-2). Null leaves the entry uncategorised; the AI
   * runs later, outside the pipeline, because it needs the network.
   */
  categorise?: (request: CategoriseRequest) => Promise<CategoryDecision | null>;
}

export interface SmsCapture {
  parsed: ParsedTransaction;
  /** Normalised header, e.g. "HDFCBK". */
  sender: string;
  receivedAt: string;
  fingerprint: string;
  rawText: string | null;
  /**
   * The account the user linked this sender to (CAP-11), for senders without
   * tuned rules. Without it, the account comes from the bank and digits.
   */
  accountId?: string;
}

export interface NotificationCapture {
  parsed: ParsedNotification;
  receivedAt: string;
  fingerprint: string;
}

export type IngestResult =
  | { outcome: 'duplicate_source' }
  | { outcome: 'created'; transactionId: string }
  | { outcome: 'attached'; transactionId: string }
  | { outcome: 'transfer'; transactionId: string }
  | { outcome: 'held' };

const OWNED: ReadonlySet<AccountType> = new Set(['bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd', 'mutual_fund', 'stock', 'nps', 'savings_scheme']);

const signed = (direction: Direction, amount: Paise) => (direction === 'debit' ? -amount : amount) as Paise;
const iso = (ms: number) => new Date(ms).toISOString();
const bumpConfidence = (a: number, b: number) => Math.min(0.99, Math.round((Math.max(a, b) + 0.05) * 100) / 100);

/**
 * Parse → match → post for one bank SMS (architecture: capture pipeline).
 * Idempotent: the same message ingested twice is recognised by its fingerprint.
 */
export async function ingestSms(ctx: PipelineContext, capture: SmsCapture): Promise<IngestResult> {
  const { store, newId } = ctx;
  if (await store.hasFingerprint(capture.fingerprint)) return { outcome: 'duplicate_source' };
  const { parsed } = capture;

  const accounts = await store.listAccounts();
  const linked = capture.accountId ? accounts.find((a) => a.id === capture.accountId) : undefined;
  if (capture.accountId && !linked) throw new Error('Linked account not found');
  const resolution = linked ? { account: linked, certain: true } : resolveAccount(parsed, accounts);
  let account: LedgerAccount;
  if ('create' in resolution) {
    account = { id: newId(), ...resolution.create };
    await store.createAccount(account);
    accounts.push(account);
  } else {
    account = resolution.account;
    if ('upgradeLast4' in resolution && resolution.upgradeLast4) await store.setAccountLast4(account.id, resolution.upgradeLast4);
  }

  const source: LedgerSource = {
    id: newId(),
    kind: 'sms',
    sender: capture.sender,
    externalRef: parsed.reference,
    fingerprint: capture.fingerprint,
    parsedFields: { ...parsed },
    receivedAt: capture.receivedAt,
    confidence: parsed.confidence,
    rawText: capture.rawText,
  };
  const amount = signed(parsed.direction, parsed.amount);
  const at = Date.parse(capture.receivedAt);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const recent = await store.transactionsBetween(iso(at - CARD_PAYMENT_WINDOW), iso(at + CARD_PAYMENT_WINDOW));

  let result: IngestResult;
  const duplicate =
    findDuplicate(recent, { accountId: account.id, amount, at, reference: parsed.reference, sender: capture.sender }) ??
    findPaidCardLeg(recent, { account, amount, at });
  const transfer = duplicate ? null : findTransferLeg(recent, accountsById, { account, amount, at, reference: parsed.reference });
  // Decision 0023: a debit that pays a credit card bill goes to that card.
  const card = parsed.direction === 'debit' ? paidCard(accounts, account, parsed.cardBill) : null;

  const handOff = duplicate || transfer ? null : findAppPayment(recent, accountsById, { amount, at });

  if (duplicate) {
    const merged = withExtraSource(duplicate, source, {
      counterparty: duplicate.counterparty ?? parsed.counterparty,
      // The bank's SMS proves a payment handed to a UPI app went through (PAY-2).
      ...(duplicate.reviewReason === 'payment_unconfirmed' ? { reviewReason: null, status: 'confirmed' as const } : {}),
      // The card's own SMS confirms a bill payment the bank's debit was sent to (decision 0023).
      ...(duplicate.kind === 'transfer' && duplicate.reviewReason === 'possible_transfer' && account.type === 'credit_card' ? { reviewReason: null, status: 'confirmed' as const } : {}),
    });
    await store.saveTransaction((card && toCardPayment(merged, accountsById, card)) || merged);
    result = { outcome: 'attached', transactionId: duplicate.id };
  } else if (handOff) {
    // PAY-2: the bank SMS for a payment started from Money Plant. The SMS knows the account, and proves it went through.
    const previous = handOff.postings.find((p) => OWNED.has(accountsById.get(p.accountId)?.type ?? 'category') && p.amount === amount);
    const merged = withExtraSource(handOff, source, {
      postings: handOff.postings.map((p) => (p === previous ? { ...p, accountId: account.id } : p)),
      ...(handOff.reviewReason === 'payment_unconfirmed' ? { reviewReason: null, status: 'confirmed' as const } : {}),
    });
    await store.saveTransaction(merged);
    if (previous && previous.accountId !== account.id) await rebaseOpening(store, previous.accountId);
    result = { outcome: 'attached', transactionId: handOff.id };
  } else if (transfer) {
    const { transaction, refsMatch } = transfer;
    const postings: LedgerPosting[] = transaction.postings
      .filter((posting) => OWNED.has(accountsById.get(posting.accountId)?.type ?? 'category'))
      .concat({ id: newId(), accountId: account.id, amount });
    const confidence = bumpConfidence(transaction.confidence, parsed.confidence);
    const reviewReason: ReviewReason | null = refsMatch || cardDigitsAgree(transaction, accountsById, account, parsed.cardBill) ? null : 'possible_transfer';
    await store.saveTransaction({
      ...transaction,
      kind: 'transfer',
      counterparty: null,
      postings,
      sources: [...transaction.sources, source],
      confidence,
      reviewReason,
      status: reviewReason ? 'pending' : 'confirmed',
      categoryReason: null,
      categoryRuleId: null,
    });
    result = { outcome: 'transfer', transactionId: transaction.id };
  } else if (card) {
    const transaction = cardPayment(newId, { occurredAt: capture.receivedAt, accountId: account.id, amount, card, source });
    if (!resolution.certain) transaction.reviewReason = 'unknown_account';
    else if (transaction.confidence < CONFIRM_THRESHOLD) transaction.reviewReason = 'low_confidence';
    transaction.status = transaction.reviewReason ? 'pending' : 'confirmed';
    await store.saveTransaction(transaction);
    result = { outcome: 'transfer', transactionId: transaction.id };
  } else {
    const other = await store.systemAccount(parsed.direction === 'debit' ? 'uncategorised_expense' : 'uncategorised_income');
    const transaction: LedgerTransaction = {
      id: newId(),
      occurredAt: capture.receivedAt,
      counterparty: parsed.counterparty,
      kind: parsed.direction === 'debit' ? 'expense' : 'income',
      status: 'confirmed',
      confidence: parsed.confidence,
      reviewReason: null,
      categoryReason: null,
      categoryRuleId: null,
      userSetFields: [],
      note: null,
      postings: [
        { id: newId(), accountId: account.id, amount },
        { id: newId(), accountId: other.id, amount: -amount as Paise },
      ],
      sources: [source],
    };
    // A UPI app notification may have arrived first; it usually has the better payee name.
    const held = (await store.pendingNotifications(iso(at - DUPLICATE_WINDOW), iso(at + DUPLICATE_WINDOW))).find(
      (n) => n.direction === parsed.direction && n.amount === parsed.amount,
    );
    if (held) {
      transaction.sources.push(held.source);
      transaction.counterparty = held.counterparty ?? transaction.counterparty;
      transaction.confidence = bumpConfidence(transaction.confidence, held.source.confidence);
      await store.removePendingNotification(held.id);
    }
    // LED-5: a refund or reversal takes the category of the payment it gives money back for.
    const refunded = parsed.refund ? await refundedPayment(store, account.id, parsed.amount, transaction) : null;
    if (refunded) {
      transaction.postings[1]!.accountId = refunded.categoryId;
      transaction.categoryReason = 'refund';
      transaction.categoryRuleId = refunded.tx.id;
      transaction.counterparty ??= refunded.tx.counterparty;
      transaction.reviewReason = !resolution.certain ? 'unknown_account' : transaction.confidence < CONFIRM_THRESHOLD ? 'low_confidence' : null;
      transaction.status = transaction.reviewReason ? 'pending' : 'confirmed';
      await store.saveTransaction(transaction);
      result = { outcome: 'created', transactionId: transaction.id };
    } else {
      const person = looksLikePerson({ channel: parsed.channel, counterparty: transaction.counterparty, vpa: parsed.vpa });
      const decision = await ctx.categorise?.({
        direction: parsed.direction,
        amount: parsed.amount,
        counterparty: transaction.counterparty,
        vpa: parsed.vpa,
        accountId: account.id,
        occurredAt: transaction.occurredAt,
        payeeKind: person ? 'person' : 'business',
      });
      if (decision) applyDecision(transaction, decision);
      transaction.reviewReason =
        !resolution.certain ? 'unknown_account'
        : transaction.confidence < CONFIRM_THRESHOLD ? 'low_confidence'
        : decision ? decisionReview(decision)
        // Learned patterns ran first, so a person they recognised is not asked about (CAT-4).
        : person ? 'person'
        : null;
      transaction.status = transaction.reviewReason ? 'pending' : 'confirmed';
      await store.saveTransaction(transaction);
      result = { outcome: 'created', transactionId: transaction.id };
    }
  }

  const reported = reportedBalance(account, parsed);
  if (reported !== null) {
    await store.addAnchor({ id: newId(), accountId: account.id, balance: reported, observedAt: capture.receivedAt, sourceId: source.id });
    const ref = await store.getBalanceRef(account.id);
    if (!ref || (ref.kind === 'anchor' && Date.parse(capture.receivedAt) < Date.parse(ref.at))) {
      await store.setBalanceRef(account.id, { kind: 'anchor', balance: reported, at: capture.receivedAt });
    }
  }
  await rebaseOpening(store, account.id);
  return result;
}

export interface StatementCapture {
  parsed: ParsedStatementRow;
  /** The account the user said the statement is for. */
  accountId: string;
  /** Local noon on the row's date; statements print no times. */
  occurredAt: string;
  /** Local midnight starting the row's date. */
  dayStart: string;
  fingerprint: string;
  /** The new source's id, so the caller can anchor the closing balance to it. */
  sourceId?: string;
}

/** A statement row matches an entry dated a day either side, since SMS times and statement dates can straddle midnight. */
export const STATEMENT_MATCH_DAYS = 1;
const DAY = 24 * HOUR;

/**
 * CAP-5: one statement row. The row usually repeats an entry the SMS already
 * made: then it is attached to that entry as a second source. Otherwise it
 * may be the other leg of a transfer, or it is a payment the SMS missed and
 * becomes a new entry, categorised like one from SMS. `claimed` holds the
 * entries earlier rows of the same import already attached to, so two
 * same-amount rows on one day stay two entries. Idempotent by fingerprint.
 * The caller rebases the account's opening balance once the import is done.
 */
/** How far a statement's rupee amount may be from an estimated one (bank markup and rate spread). */
const ESTIMATE_TOLERANCE = 0.1;

/**
 * CAP-10: an entry whose amount was converted on the phone from a foreign
 * amount in the SMS, and not yet replaced by the statement's rupee amount.
 */
export function isEstimated(tx: Pick<LedgerTransaction, 'sources'>): boolean {
  return tx.sources.some((s) => s.parsedFields.foreign !== undefined) && !tx.sources.some((s) => s.kind === 'statement');
}

/** CAP-10: the foreign amount an SMS gave for this entry, if one did. */
export function foreignAmount(tx: Pick<LedgerTransaction, 'sources'>): { amount: number; currency: string } | null {
  for (const s of tx.sources) {
    const foreign = s.parsedFields.foreign as { amount?: unknown; currency?: unknown } | undefined;
    if (foreign && typeof foreign.amount === 'number' && typeof foreign.currency === 'string') return { amount: foreign.amount, currency: foreign.currency };
  }
  return null;
}

export async function ingestStatementRow(ctx: PipelineContext, capture: StatementCapture, claimed: Set<string>): Promise<IngestResult> {
  const { store, newId } = ctx;
  const { parsed } = capture;
  const accounts = await store.listAccounts();
  const account = accounts.find((a) => a.id === capture.accountId);
  if (!account) throw new Error('Statement account not found');
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const card = parsed.direction === 'debit' ? paidCard(accounts, account, parsed.cardBill) : null;
  if (await store.hasFingerprint(capture.fingerprint)) {
    // Imported before this reader knew card bills, or before the card was added: it becomes the transfer now.
    if (card) await upgradeToCardPayment(store, accountsById, card, capture);
    return { outcome: 'duplicate_source' };
  }

  const source: LedgerSource = {
    id: capture.sourceId ?? newId(),
    kind: 'statement',
    sender: parsed.bank,
    externalRef: parsed.reference,
    fingerprint: capture.fingerprint,
    parsedFields: { ...parsed },
    receivedAt: capture.occurredAt,
    confidence: 0.95,
    rawText: null,
  };
  const amount = signed(parsed.direction, parsed.amount);
  const at = Date.parse(capture.occurredAt);
  const day = Date.parse(capture.dayStart);
  const recent = (await store.transactionsBetween(iso(day - STATEMENT_MATCH_DAYS * DAY), iso(day + (1 + STATEMENT_MATCH_DAYS) * DAY - 1))).filter(
    (tx) => !claimed.has(tx.id),
  );

  const sameLeg = (tx: LedgerTransaction) => tx.postings.some((p) => p.accountId === account.id && p.amount === amount);
  const open = recent.filter((tx) => sameLeg(tx) && !tx.sources.some((s) => s.kind === 'statement') && !refsConflict(tx, parsed.reference));
  const duplicate = (parsed.reference !== null ? open.find((tx) => refsOf(tx).includes(parsed.reference!)) : undefined) ?? closest(open, at);
  if (duplicate) {
    claimed.add(duplicate.id);
    const merged = withExtraSource(duplicate, source, { counterparty: duplicate.counterparty ?? parsed.counterparty });
    await store.saveTransaction((card && toCardPayment(merged, accountsById, card)) || merged);
    return { outcome: 'attached', transactionId: duplicate.id };
  }

  // CAP-10: a foreign spend whose rupee amount was estimated from the day's rate. The statement
  // has the amount the bank charged, so it replaces the estimate (the markup included).
  const estimate = closest(
    recent.filter(
      (tx) =>
        isEstimated(tx) &&
        tx.postings.length === 2 &&
        tx.postings.some((p) => p.accountId === account.id && Math.sign(p.amount) === Math.sign(amount) && Math.abs(p.amount - amount) <= Math.abs(amount) * ESTIMATE_TOLERANCE),
    ),
    at,
  );
  if (estimate) {
    claimed.add(estimate.id);
    const updated = withExtraSource(estimate, source, { counterparty: estimate.counterparty ?? parsed.counterparty });
    // An amount the user typed in stays theirs.
    const keep = estimate.userSetFields.includes('amount');
    await store.saveTransaction(
      keep ? updated : { ...updated, postings: estimate.postings.map((p) => ({ ...p, amount: (p.accountId === account.id ? amount : -amount) as Paise })) },
    );
    return { outcome: 'attached', transactionId: estimate.id };
  }

  const transfer = findTransferLeg(recent, accountsById, { account, amount, at, reference: parsed.reference });
  if (transfer) {
    const { transaction, refsMatch } = transfer;
    claimed.add(transaction.id);
    const reviewReason: ReviewReason | null = refsMatch || cardDigitsAgree(transaction, accountsById, account, parsed.cardBill) ? null : 'possible_transfer';
    await store.saveTransaction({
      ...transaction,
      kind: 'transfer',
      counterparty: null,
      postings: transaction.postings
        .filter((posting) => OWNED.has(accountsById.get(posting.accountId)?.type ?? 'category'))
        .concat({ id: newId(), accountId: account.id, amount }),
      sources: [...transaction.sources, source],
      confidence: bumpConfidence(transaction.confidence, source.confidence),
      reviewReason,
      status: reviewReason ? 'pending' : 'confirmed',
      categoryReason: null,
      categoryRuleId: null,
    });
    return { outcome: 'transfer', transactionId: transaction.id };
  }

  if (card) {
    const transaction = cardPayment(newId, { occurredAt: capture.occurredAt, accountId: account.id, amount, card, source });
    await store.saveTransaction(transaction);
    return { outcome: 'transfer', transactionId: transaction.id };
  }

  const other = await store.systemAccount(parsed.direction === 'debit' ? 'uncategorised_expense' : 'uncategorised_income');
  const transaction: LedgerTransaction = {
    id: newId(),
    occurredAt: capture.occurredAt,
    counterparty: parsed.counterparty,
    kind: parsed.direction === 'debit' ? 'expense' : 'income',
    status: 'confirmed',
    confidence: source.confidence,
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: [],
    note: null,
    postings: [
      { id: newId(), accountId: account.id, amount },
      { id: newId(), accountId: other.id, amount: -amount as Paise },
    ],
    sources: [source],
  };
  const person = looksLikePerson({ channel: parsed.channel, counterparty: parsed.counterparty, vpa: parsed.vpa });
  const decision = await ctx.categorise?.({
    direction: parsed.direction,
    amount: parsed.amount,
    counterparty: parsed.counterparty,
    vpa: parsed.vpa,
    accountId: account.id,
    occurredAt: capture.occurredAt,
    payeeKind: person ? 'person' : 'business',
  });
  if (decision) applyDecision(transaction, decision);
  transaction.reviewReason = decision ? decisionReview(decision) : person ? 'person' : null;
  transaction.status = transaction.reviewReason ? 'pending' : 'confirmed';
  await store.saveTransaction(transaction);
  return { outcome: 'created', transactionId: transaction.id };
}

/**
 * Attaches a UPI app notification to the bank SMS entry for the same payment,
 * or holds it until that SMS arrives. Notifications never create entries on
 * their own, because they don't say which account paid.
 */
export async function ingestNotification(ctx: PipelineContext, capture: NotificationCapture): Promise<IngestResult> {
  const { store, newId } = ctx;
  if (await store.hasFingerprint(capture.fingerprint)) return { outcome: 'duplicate_source' };
  const { parsed } = capture;
  const source: LedgerSource = {
    id: newId(),
    kind: 'notification',
    sender: parsed.app,
    externalRef: null,
    fingerprint: capture.fingerprint,
    parsedFields: { ...parsed },
    receivedAt: capture.receivedAt,
    confidence: 0.6,
    rawText: null,
  };
  const at = Date.parse(capture.receivedAt);
  const amount = signed(parsed.direction, parsed.amount);
  const accountsById = new Map((await store.listAccounts()).map((a) => [a.id, a]));
  const recent = await store.transactionsBetween(iso(at - DUPLICATE_WINDOW), iso(at + DUPLICATE_WINDOW));
  const match = closest(
    recent.filter(
      (tx) =>
        !tx.sources.some((s) => s.kind === 'notification') &&
        tx.postings.some((p) => p.amount === amount && OWNED.has(accountsById.get(p.accountId)?.type ?? 'category')),
    ),
    at,
  );
  if (match) {
    const updated = withExtraSource(match, source, { counterparty: parsed.counterparty ?? match.counterparty });
    // The app's payee name often names the merchant the bank SMS didn't.
    if (updated.counterparty !== match.counterparty) await recategorise(ctx, updated, accountsById);
    await store.saveTransaction(updated);
    return { outcome: 'attached', transactionId: match.id };
  }
  await store.addPendingNotification({
    id: newId(),
    direction: parsed.direction,
    amount: parsed.amount,
    counterparty: parsed.counterparty,
    source,
  });
  return { outcome: 'held' };
}

/** Recomputes the opening balance so the balance at the reference point stays what the user or bank said. */
export async function rebaseOpening(store: LedgerStore, accountId: string): Promise<void> {
  const ref = await store.getBalanceRef(accountId);
  if (!ref) return;
  const before = await store.sumPostings(accountId, ref.at);
  await store.setOpeningBalance(accountId, (ref.balance - before) as Paise);
}

/** LED-5: the earlier payment a refund matches, with the category it sits on, unless that payment is uncategorised. */
async function refundedPayment(
  store: LedgerStore,
  accountId: string,
  amount: Paise,
  refund: LedgerTransaction,
): Promise<{ tx: LedgerTransaction; categoryId: string } | null> {
  const at = Date.parse(refund.occurredAt);
  const candidates = await store.transactionsBetween(iso(at - REFUND_WINDOW_DAYS * 24 * HOUR), refund.occurredAt);
  const tx = findRefunded({ accountId, amount, counterparty: refund.counterparty, occurredAt: refund.occurredAt }, candidates);
  if (!tx) return null;
  const uncategorised = await store.systemAccount('uncategorised_expense');
  const accounts = new Map((await store.listAccounts()).map((a) => [a.id, a]));
  const category = tx.postings.find((p) => p.accountId !== accountId && accounts.get(p.accountId)?.type === 'category');
  if (!category || category.accountId === uncategorised.id) return null;
  return { tx, categoryId: category.accountId };
}

/** Puts the entry's category posting on the decided category. */
function applyDecision(tx: LedgerTransaction, decision: CategoryDecision): void {
  const categoryLeg = tx.postings[1];
  if (!categoryLeg) return;
  categoryLeg.accountId = decision.categoryId;
  tx.categoryReason = decision.reason;
  tx.categoryRuleId = decision.ruleId;
  tx.note = noteFor(tx, decision);
}

/** CAT-7: a rule's or pattern's default note goes on an entry that has no note of its own. */
export function noteFor(tx: Pick<LedgerTransaction, 'note' | 'userSetFields'>, decision: Pick<CategoryDecision, 'note'>): string | null {
  if (tx.note || tx.userSetFields.includes('note')) return tx.note;
  return decision.note?.trim() || tx.note;
}

/** A confident decision needs no review; a pattern match or an unsure answer waits as a suggestion. */
export function decisionReview(decision: CategoryDecision): ReviewReason | null {
  if (decision.autoConfirm) return null;
  return decision.reason === 'pattern' ? 'pattern' : 'category_unsure';
}

/**
 * Categorises an uncategorised entry again after it learned a better payee
 * name. Leaves alone anything the user set or another layer already decided.
 */
async function recategorise(ctx: PipelineContext, tx: LedgerTransaction, accountsById: ReadonlyMap<string, LedgerAccount>): Promise<void> {
  if (!ctx.categorise || tx.categoryReason !== null || tx.userSetFields.includes('category')) return;
  if ((tx.kind !== 'expense' && tx.kind !== 'income') || tx.postings.length !== 2) return;
  const own = tx.postings[0]!;
  if (!OWNED.has(accountsById.get(own.accountId)?.type ?? 'category')) return;
  const sms = tx.sources.find((s) => s.kind === 'sms')?.parsedFields as Partial<ParsedTransaction> | undefined;
  const vpa = sms?.vpa ?? null;
  const person = looksLikePerson({ channel: sms?.channel ?? 'upi', counterparty: tx.counterparty, vpa });
  const decision = await ctx.categorise({
    direction: own.amount < 0 ? 'debit' : 'credit',
    amount: Math.abs(own.amount) as Paise,
    counterparty: tx.counterparty,
    vpa,
    accountId: own.accountId,
    occurredAt: tx.occurredAt,
    payeeKind: person ? 'person' : 'business',
  });
  if (!decision) return;
  applyDecision(tx, decision);
  if (tx.reviewReason === null || tx.reviewReason === 'person') {
    tx.reviewReason = decisionReview(decision);
    tx.status = tx.reviewReason ? 'pending' : 'confirmed';
  }
}

/**
 * A second source raises confidence, which can clear a low-confidence review
 * item. Fields the user set (LED-8) keep the user's value.
 */
function withExtraSource(tx: LedgerTransaction, source: LedgerSource, changes: Partial<LedgerTransaction>): LedgerTransaction {
  const confidence = bumpConfidence(tx.confidence, source.confidence);
  const cleared = tx.reviewReason === 'low_confidence' && confidence >= CONFIRM_THRESHOLD;
  if (tx.userSetFields.includes('counterparty')) delete changes.counterparty;
  return {
    ...tx,
    ...changes,
    confidence,
    sources: [...tx.sources, source],
    ...(cleared ? { reviewReason: null, status: 'confirmed' as const } : {}),
  };
}

function closest(transactions: readonly LedgerTransaction[], at: number): LedgerTransaction | null {
  let best: LedgerTransaction | null = null;
  for (const tx of transactions) {
    if (!best || Math.abs(Date.parse(tx.occurredAt) - at) < Math.abs(Date.parse(best.occurredAt) - at)) best = tx;
  }
  return best;
}

const refsOf = (tx: LedgerTransaction) => tx.sources.map((s) => s.externalRef).filter((r): r is string => r !== null);
/** Two different references mean two different payments. */
const refsConflict = (tx: LedgerTransaction, reference: string | null) => {
  const refs = refsOf(tx);
  return reference !== null && refs.length > 0 && !refs.includes(reference);
};

/** Matching rules 1 and 2: the same payment reported again, by another message or source. */
function findDuplicate(
  recent: readonly LedgerTransaction[],
  c: { accountId: string; amount: Paise; at: number; reference: string | null; sender: string },
): LedgerTransaction | null {
  const sameLeg = (tx: LedgerTransaction) => tx.postings.some((p) => p.accountId === c.accountId && p.amount === c.amount);
  if (c.reference !== null) {
    const byRef = recent.find((tx) => sameLeg(tx) && refsOf(tx).includes(c.reference!));
    if (byRef) return byRef;
  }
  return closest(
    recent.filter(
      (tx) =>
        sameLeg(tx) &&
        Math.abs(Date.parse(tx.occurredAt) - c.at) <= DUPLICATE_WINDOW &&
        // Two SMS from the same sender are two payments; a duplicate comes from somewhere else.
        !tx.sources.some((s) => s.kind === 'sms' && s.sender === c.sender) &&
        !refsConflict(tx, c.reference),
    ),
    c.at,
  );
}

/**
 * PAY-2: a payment the user started from Money Plant, waiting for its bank
 * SMS. The user picked an account before paying, but chose the bank inside
 * the UPI app, so the first debit of the same amount within 10 minutes after
 * it matches on any of the user's accounts.
 */
function findAppPayment(
  recent: readonly LedgerTransaction[],
  accountsById: ReadonlyMap<string, LedgerAccount>,
  c: { amount: Paise; at: number },
): LedgerTransaction | null {
  if (c.amount >= 0) return null;
  return closest(
    recent.filter((tx) => {
      const started = Date.parse(tx.occurredAt);
      return (
        tx.sources.some((s) => s.kind === 'app_payment') &&
        !tx.sources.some((s) => s.kind === 'sms') &&
        c.at >= started - MINUTE &&
        c.at - started <= DUPLICATE_WINDOW &&
        tx.postings.some((p) => OWNED.has(accountsById.get(p.accountId)?.type ?? 'category') && p.amount === c.amount)
      );
    }),
    c.at,
  );
}

/** Matching rules 3 and 4: the other leg of a transfer between the user's own accounts, or a card bill payment. */
function findTransferLeg(
  recent: readonly LedgerTransaction[],
  accountsById: ReadonlyMap<string, LedgerAccount>,
  c: { account: LedgerAccount; amount: Paise; at: number; reference: string | null },
): { transaction: LedgerTransaction; refsMatch: boolean } | null {
  const candidates: { transaction: LedgerTransaction; refsMatch: boolean }[] = [];
  for (const tx of recent) {
    if (tx.kind !== 'expense' && tx.kind !== 'income') continue;
    // The user already said what this entry is.
    if (tx.userSetFields.includes('category') || tx.userSetFields.includes('kind')) continue;
    const owned = tx.postings.filter((p) => OWNED.has(accountsById.get(p.accountId)?.type ?? 'category'));
    if (owned.length !== 1 || tx.postings.length !== 2) continue;
    const leg = owned[0]!;
    if (leg.accountId === c.account.id || leg.amount !== -c.amount) continue;
    const legAccount = accountsById.get(leg.accountId)!;
    const window = legAccount.type === 'credit_card' || c.account.type === 'credit_card' ? CARD_PAYMENT_WINDOW : TRANSFER_WINDOW;
    if (Math.abs(Date.parse(tx.occurredAt) - c.at) > window) continue;
    const refsMatch = c.reference !== null && refsOf(tx).includes(c.reference);
    if (!refsMatch && refsConflict(tx, c.reference)) continue;
    candidates.push({ transaction: tx, refsMatch });
  }
  const exact = candidates.find((candidate) => candidate.refsMatch);
  if (exact) return exact;
  const best = closest(candidates.map((candidate) => candidate.transaction), c.at);
  return best ? { transaction: best, refsMatch: false } : null;
}

/**
 * Decision 0023: the credit card a bill payment went to. Certain when the
 * card's last digits match the ones the bank printed; otherwise only the
 * user's one card (with no digits known, if digits were printed), and the
 * entry waits in Review.
 */
export function paidCard(
  accounts: readonly LedgerAccount[],
  from: LedgerAccount,
  cardBill: CardBill | undefined,
): { card: LedgerAccount; certain: boolean } | null {
  if (!cardBill || from.type === 'credit_card') return null;
  const cards = accounts.filter((a) => a.type === 'credit_card' && a.id !== from.id);
  const last4 = cardBill.last4;
  if (last4 === null) return cards.length === 1 ? { card: cards[0]!, certain: false } : null;
  const byDigits = cards.filter((c) => c.last4 !== null && digitsMatch(c.last4, last4));
  if (byDigits.length > 0) return { card: byDigits[0]!, certain: byDigits.length === 1 };
  return cards.length === 1 && cards[0]!.last4 === null ? { card: cards[0]!, certain: false } : null;
}

/** A new transfer from a bank account to the credit card it paid. */
function cardPayment(
  newId: () => string,
  p: { occurredAt: string; accountId: string; amount: Paise; card: { card: LedgerAccount; certain: boolean }; source: LedgerSource },
): LedgerTransaction {
  const reviewReason: ReviewReason | null = p.card.certain ? null : 'possible_transfer';
  return {
    id: newId(),
    occurredAt: p.occurredAt,
    counterparty: null,
    kind: 'transfer',
    status: reviewReason ? 'pending' : 'confirmed',
    confidence: p.source.confidence,
    reviewReason,
    categoryReason: null,
    categoryRuleId: null,
    userSetFields: [],
    note: null,
    postings: [
      { id: newId(), accountId: p.accountId, amount: p.amount },
      { id: newId(), accountId: p.card.card.id, amount: -p.amount as Paise },
    ],
    sources: [p.source],
  };
}

/**
 * An expense that turns out to be a card bill payment becomes a transfer to
 * the card. Null when the user already said what it is, or it isn't a plain
 * two-leg expense.
 */
function toCardPayment(
  tx: LedgerTransaction,
  accountsById: ReadonlyMap<string, LedgerAccount>,
  card: { card: LedgerAccount; certain: boolean },
): LedgerTransaction | null {
  if (tx.kind !== 'expense' || tx.userSetFields.includes('category') || tx.userSetFields.includes('kind') || tx.postings.length !== 2) return null;
  const other = tx.postings.find((p) => !OWNED.has(accountsById.get(p.accountId)?.type ?? 'category'));
  if (!other) return null;
  // Questions about the payee or category no longer apply to a transfer; doubts about the message or account still do.
  const kept = tx.reviewReason === 'unknown_account' || tx.reviewReason === 'low_confidence' ? tx.reviewReason : null;
  const reviewReason: ReviewReason | null = card.certain ? kept : 'possible_transfer';
  return {
    ...tx,
    kind: 'transfer',
    counterparty: null,
    postings: tx.postings.map((p) => (p === other ? { ...p, accountId: card.card.id } : p)),
    reviewReason,
    status: reviewReason ? 'pending' : 'confirmed',
    categoryReason: null,
    categoryRuleId: null,
  };
}

/** A statement row seen before: its entry becomes the card transfer, and its source learns the card. */
async function upgradeToCardPayment(
  store: LedgerStore,
  accountsById: ReadonlyMap<string, LedgerAccount>,
  card: { card: LedgerAccount; certain: boolean },
  capture: StatementCapture,
): Promise<void> {
  const day = Date.parse(capture.dayStart);
  const entries = await store.transactionsBetween(iso(day - DAY), iso(day + 2 * DAY - 1));
  const tx = entries.find((t) => t.sources.some((s) => s.fingerprint === capture.fingerprint));
  if (!tx) return;
  const upgraded = toCardPayment(tx, accountsById, card);
  if (!upgraded) return;
  await store.saveTransaction({
    ...upgraded,
    sources: upgraded.sources.map((s) => (s.fingerprint === capture.fingerprint ? { ...s, parsedFields: { ...s.parsedFields, cardBill: capture.parsed.cardBill } } : s)),
  });
}

/** Whether the bank printed the same last digits as the card on the other side of a transfer. */
function cardDigitsAgree(
  tx: LedgerTransaction,
  accountsById: ReadonlyMap<string, LedgerAccount>,
  account: LedgerAccount,
  cardBill: CardBill | undefined,
): boolean {
  const legs = tx.postings.map((p) => accountsById.get(p.accountId)).concat(account);
  const card = legs.find((a) => a?.type === 'credit_card');
  const last4 = cardBill?.last4 ?? tx.sources.map((s) => (s.parsedFields.cardBill as CardBill | undefined)?.last4).find((d) => typeof d === 'string') ?? null;
  return !!card?.last4 && last4 !== null && digitsMatch(card.last4, last4);
}

/**
 * Decision 0023: the card's own "payment received" message for a bill
 * payment the bank's debit already sent to this card. Cards can take a few
 * days to show it.
 */
function findPaidCardLeg(recent: readonly LedgerTransaction[], c: { account: LedgerAccount; amount: Paise; at: number }): LedgerTransaction | null {
  if (c.account.type !== 'credit_card' || c.amount <= 0) return null;
  return closest(
    recent.filter(
      (tx) =>
        tx.kind === 'transfer' &&
        Math.abs(Date.parse(tx.occurredAt) - c.at) <= CARD_PAYMENT_WINDOW &&
        tx.postings.some((p) => p.accountId === c.account.id && p.amount === c.amount) &&
        tx.sources.every((s) => s.parsedFields.cardBill !== undefined),
    ),
    c.at,
  );
}

/**
 * The balance an SMS reports for its account (LED-7): a bank's available
 * balance, or for a credit card with a known limit, what it owes: the limit
 * minus the available limit, as a negative balance (decision 0024).
 */
export function reportedBalance(account: LedgerAccount, parsed: Pick<ParsedTransaction, 'balance' | 'availableLimit'>): Paise | null {
  if (account.type === 'bank') return parsed.balance;
  if (account.type === 'credit_card') return cardBalance(account.creditLimit ?? null, parsed.availableLimit);
  return null;
}

/** A card's balance from its limit and the available limit an SMS printed; positive when the card is in credit. */
export function cardBalance(creditLimit: Paise | null, availableLimit: Paise | null): Paise | null {
  if (creditLimit === null || availableLimit === null || creditLimit <= 0) return null;
  return (availableLimit - creditLimit) as Paise;
}

/** Checks a transaction against the ledger rules before it is saved or synced. */
export function checkTransaction(tx: LedgerTransaction): string | null {
  const postingError = validatePostings(tx.postings);
  if (postingError) return `postings: ${postingError.code}`;
  if (tx.sources.length === 0) return 'no source';
  return null;
}
