import { Linking } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as IntentLauncher from 'expo-intent-launcher';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { buildUpiUri, parseUpiResponse, parseUpiUri, type Paise, type UpiPayment, type UpiStatus } from '@money-plant/core';
import type { CategoryDecision } from '@money-plant/categoriser';
import { decisionReview, rebaseOpening, type LedgerTransaction } from '@money-plant/matcher';
import { transactions } from '@money-plant/db-schema';
import { ownedAccountIds, pipelineCategoriser } from './categories';
import { getDb } from './db';
import { confirmEntry } from './entries';
import { notifyLedgerChange } from './events';
import { deleteTransaction } from './ledger';
import { loadTransactions, SqliteLedgerStore, systemAccountId, writeTransaction } from './ledger-store';

/**
 * IOU-3, PAY-1: hands a upi://pay link to the user's own UPI app. Android
 * shows its app chooser when more than one is installed. Nothing here moves
 * money: the UPI app asks for the PIN and does the payment.
 */
export async function openUpiLink(uri: string): Promise<void> {
  try {
    await Linking.openURL(uri);
  } catch {
    throw new Error('No UPI app on this phone opened the link');
  }
}

/** A merchant QR has a merchant code; a friend's has none or 0000. */
export const isShop = (payment: UpiPayment) => payment.merchantCode !== undefined && payment.merchantCode !== '0000';

/** UPI apps put their response in different places: an extra named "response", other extras, or the data URI. */
function responseText(result: IntentLauncher.IntentLauncherResult): string | undefined {
  const extra = (result.extra ?? {}) as Record<string, unknown>;
  if (typeof extra.response === 'string') return extra.response;
  const pairs = Object.entries(extra)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => `${key}=${value as string}`);
  if (pairs.length > 0) return pairs.join('&');
  return result.data ?? undefined;
}

/** Recent expense entries, newest first, for the payee helpers below. */
async function recentExpenses() {
  const db = await getDb();
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.kind, 'expense'), gte(transactions.occurredAt, since)))
    .orderBy(desc(transactions.occurredAt))
    .limit(500)
    .all();
  return { owned: ownedAccountIds(db), txs: loadTransactions(db, rows) };
}

const vpaOf = (tx: LedgerTransaction): string | null => {
  for (const s of tx.sources) {
    const f = s.parsedFields as { vpa?: unknown };
    if (typeof f.vpa === 'string' && f.vpa.includes('@')) return f.vpa.toLowerCase();
  }
  return null;
};

/** PAY-1: people and shops paid by UPI lately, newest first, for paying again without scanning. */
export async function recentPayees(limit = 4): Promise<UpiPayment[]> {
  const { txs } = await recentExpenses();
  const seen = new Map<string, UpiPayment>();
  for (const tx of txs) {
    const vpa = vpaOf(tx);
    if (!vpa || seen.has(vpa)) continue;
    const payee = parseUpiUri(`upi://pay?pa=${encodeURIComponent(vpa)}${tx.counterparty ? `&pn=${encodeURIComponent(tx.counterparty)}` : ''}`);
    if (payee) seen.set(vpa, payee);
    if (seen.size === limit) break;
  }
  return [...seen.values()];
}

export interface PayeeGuess {
  /** The account the user usually pays from, shown as a hint; the UPI app decides. */
  accountId: string | null;
  /** What the entry is logged under until the user says, or null for Uncategorised. */
  decision: CategoryDecision | null;
  /** Why, in words, for the Paid sheet. */
  hint: string | null;
}

/**
 * PAY-1: the account and category to start a payment with. The category the
 * user picked the last times they paid this UPI ID comes first, then the
 * usual rules, patterns and merchant dictionary.
 */
export async function guessForPayee(payment: UpiPayment, amount: Paise | null): Promise<PayeeGuess> {
  const { owned, txs } = await recentExpenses();
  const target = payment.payeeVpa.toLowerCase();
  const paid = txs.filter((tx) => vpaOf(tx) === target);
  // Without a past payment to them, the account of the latest UPI debit.
  const latest = paid[0] ?? txs.find((tx) => tx.postings.some((p) => owned.has(p.accountId) && p.amount < 0));
  const accountId = latest?.postings.find((p) => owned.has(p.accountId))?.accountId ?? null;
  const categoryOf = (tx: LedgerTransaction) => tx.postings.find((p) => !owned.has(p.accountId) && p.amount > 0)?.accountId ?? null;
  const last = paid[0] && paid[0].userSetFields.includes('category') ? categoryOf(paid[0]) : null;
  if (last) {
    let streak = 0;
    while (streak < paid.length && streak < 3 && categoryOf(paid[streak]!) === last) streak++;
    return {
      accountId,
      decision: { categoryId: last, reason: 'user', ruleId: null, confidence: 1, autoConfirm: true },
      hint: streak > 1 ? `Your last ${streak} payments here` : 'Your last payment here',
    };
  }
  if (!accountId) return { accountId, decision: null, hint: null };
  const categorise = await pipelineCategoriser();
  const decision = await categorise({
    direction: 'debit',
    amount: amount ?? (0 as Paise),
    counterparty: payment.payeeName ?? null,
    vpa: payment.payeeVpa,
    accountId,
    occurredAt: new Date().toISOString(),
    payeeKind: isShop(payment) ? 'business' : 'person',
  });
  const hints: Record<string, string> = { rule: 'Your rule for this payee', pattern: 'Your usual pattern', dictionary: 'From the shop name', ai: 'A guess from the shop name' };
  return { accountId, decision, hint: decision ? (hints[decision.reason] ?? null) : null };
}

export interface PaymentResult {
  transactionId: string;
  /** What the UPI app said; `unknown` when it said nothing usable. */
  status: UpiStatus;
}

/**
 * PAY-1, PAY-2: logs the payment, then opens the UPI app with everything
 * filled in. The entry exists before the app opens, so it survives the app
 * being killed meanwhile. A SUCCESS answer confirms it, a failure removes it,
 * and anything else leaves it asking "Did it go through?". The bank SMS merges
 * into it later and moves it to the account that really paid.
 */
export async function payWithUpi(input: {
  payment: UpiPayment;
  amount: Paise;
  /** The category to log it under for now; null is Uncategorised, which waits in Review. */
  decision: CategoryDecision | null;
  accountId: string;
  note: string | null;
}): Promise<PaymentResult> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter an amount above zero');
  if (input.payment.amount !== undefined && input.payment.amount !== input.amount) throw new Error('This QR code fixes the amount');
  const db = await getDb();
  if (!ownedAccountIds(db).has(input.accountId)) throw new Error('Pick one of your accounts');
  const id = Crypto.randomUUID();
  // Our own reference, unless the shop's QR carries one (it may be signed, and the shop matches on it).
  const reference = input.payment.reference ?? `MP${id.replace(/-/g, '').slice(0, 20).toUpperCase()}`;
  const note = input.note?.trim() || input.payment.note || undefined;
  const categoryId = input.decision?.categoryId ?? (await systemAccountId('uncategorised_expense'));
  const counterparty = input.payment.payeeName?.trim() || input.payment.payeeVpa;
  const at = new Date().toISOString();
  const entry: LedgerTransaction = {
    id,
    occurredAt: at,
    counterparty,
    kind: 'expense',
    status: 'pending',
    confidence: 1,
    reviewReason: 'payment_unconfirmed',
    categoryReason: input.decision?.reason ?? null,
    categoryRuleId: input.decision?.ruleId ?? null,
    userSetFields: input.decision?.reason === 'user' ? ['category', 'counterparty'] : ['counterparty'],
    note: note ?? null,
    postings: [
      { id: Crypto.randomUUID(), accountId: input.accountId, amount: -input.amount as Paise },
      { id: Crypto.randomUUID(), accountId: categoryId, amount: input.amount },
    ],
    sources: [
      {
        id: Crypto.randomUUID(),
        kind: 'app_payment',
        sender: null,
        // Not the bank's reference, so it never blocks the SMS from merging in.
        externalRef: null,
        fingerprint: `app_payment:${id}`,
        parsedFields: {
          direction: 'debit',
          amount: input.amount,
          counterparty,
          vpa: input.payment.payeeVpa,
          merchantCode: input.payment.merchantCode ?? null,
          reference,
          app: 'Android chooser',
          status: 'started',
        },
        receivedAt: at,
        confidence: 1,
        rawText: null,
      },
    ],
  };
  writeTransaction(db, entry);
  await rebaseOpening(new SqliteLedgerStore(db), input.accountId);
  notifyLedgerChange();

  let status: UpiStatus;
  let fields: Record<string, unknown>;
  try {
    const result = await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: buildUpiUri(input.payment, { amount: input.amount, reference, note }),
    });
    const response = parseUpiResponse(responseText(result));
    status = response.status;
    fields = { status, responseCode: response.responseCode ?? null, txnId: response.txnId ?? null, approvalRef: response.approvalRef ?? null };
  } catch (e) {
    await deleteTransaction(id);
    throw new Error(`No UPI app opened. ${e instanceof Error ? e.message : ''}`.trim());
  }

  // The SMS may have merged in while the UPI app was open; build on the entry as it is now.
  const [current] = loadTransactions(db, db.select().from(transactions).where(eq(transactions.id, id)).all());
  if (!current) return { transactionId: id, status };
  writeTransaction(db, {
    ...current,
    sources: current.sources.map((s) => (s.kind === 'app_payment' ? { ...s, parsedFields: { ...s.parsedFields, ...fields } } : s)),
    ...(status === 'success' && current.reviewReason === 'payment_unconfirmed' ? settled(input.decision) : {}),
  });
  notifyLedgerChange();
  const smsArrived = current.sources.some((s) => s.kind === 'sms');
  if (status === 'failure' && !smsArrived) await deleteTransaction(id);
  return { transactionId: id, status: smsArrived ? 'success' : status };
}

/** A payment that went through is done, unless its category still needs the user (Uncategorised or a suggestion). */
function settled(decision: CategoryDecision | null): Pick<LedgerTransaction, 'status' | 'reviewReason'> {
  const review = decision ? decisionReview(decision) : 'category_unsure';
  return review ? { status: 'pending', reviewReason: review } : { status: 'confirmed', reviewReason: null };
}

/** The user's answer to "Did it go through?" when the UPI app didn't say. */
export async function settleUnconfirmed(transactionId: string, wentThrough: boolean, decision: CategoryDecision | null): Promise<void> {
  if (!wentThrough) return deleteTransaction(transactionId);
  const db = await getDb();
  const [tx] = loadTransactions(db, db.select().from(transactions).where(eq(transactions.id, transactionId)).all());
  if (!tx) return;
  if (tx.reviewReason !== 'payment_unconfirmed') return confirmEntry(transactionId);
  writeTransaction(db, { ...tx, ...settled(decision) });
  notifyLedgerChange();
}
