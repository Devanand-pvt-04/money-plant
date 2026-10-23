import { validatePostings, type AccountType, type Paise } from '@money-plant/core';
import type { CategoryDecision, PayeeKind } from '@money-plant/categoriser';
import type { Direction, ParsedNotification, ParsedTransaction } from '@money-plant/parser';
import { looksLikePerson, resolveAccount } from './accounts';
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

const OWNED: ReadonlySet<AccountType> = new Set(['bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd', 'mutual_fund', 'stock']);

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
  const resolution = resolveAccount(parsed, accounts);
  let account: LedgerAccount;
  if ('create' in resolution) {
    account = { id: newId(), ...resolution.create };
    await store.createAccount(account);
    accounts.push(account);
  } else {
    account = resolution.account;
    if (resolution.upgradeLast4) await store.setAccountLast4(account.id, resolution.upgradeLast4);
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
  const duplicate = findDuplicate(recent, { accountId: account.id, amount, at, reference: parsed.reference, sender: capture.sender });
  const transfer = duplicate ? null : findTransferLeg(recent, accountsById, { account, amount, at, reference: parsed.reference });

  if (duplicate) {
    await store.saveTransaction(withExtraSource(duplicate, source, { counterparty: duplicate.counterparty ?? parsed.counterparty }));
    result = { outcome: 'attached', transactionId: duplicate.id };
  } else if (transfer) {
    const { transaction, refsMatch } = transfer;
    const postings: LedgerPosting[] = transaction.postings
      .filter((posting) => OWNED.has(accountsById.get(posting.accountId)?.type ?? 'category'))
      .concat({ id: newId(), accountId: account.id, amount });
    const confidence = bumpConfidence(transaction.confidence, parsed.confidence);
    const reviewReason: ReviewReason | null = refsMatch ? null : 'possible_transfer';
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

  if (parsed.balance !== null && account.type === 'bank') {
    await store.addAnchor({ id: newId(), accountId: account.id, balance: parsed.balance, observedAt: capture.receivedAt, sourceId: source.id });
    const ref = await store.getBalanceRef(account.id);
    if (!ref || (ref.kind === 'anchor' && Date.parse(capture.receivedAt) < Date.parse(ref.at))) {
      await store.setBalanceRef(account.id, { kind: 'anchor', balance: parsed.balance, at: capture.receivedAt });
    }
  }
  await rebaseOpening(store, account.id);
  return result;
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

/** Puts the entry's category posting on the decided category. */
function applyDecision(tx: LedgerTransaction, decision: CategoryDecision): void {
  const categoryLeg = tx.postings[1];
  if (!categoryLeg) return;
  categoryLeg.accountId = decision.categoryId;
  tx.categoryReason = decision.reason;
  tx.categoryRuleId = decision.ruleId;
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

/** Checks a transaction against the ledger rules before it is saved or synced. */
export function checkTransaction(tx: LedgerTransaction): string | null {
  const postingError = validatePostings(tx.postings);
  if (postingError) return `postings: ${postingError.code}`;
  if (tx.sources.length === 0) return 'no source';
  return null;
}
