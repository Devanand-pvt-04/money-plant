import { Linking } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as IntentLauncher from 'expo-intent-launcher';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { buildUpiUri, parseUpiResponse, type Paise, type UpiPayment, type UpiStatus } from '@money-plant/core';
import { rebaseOpening, type LedgerTransaction } from '@money-plant/matcher';
import { transactions } from '@money-plant/db-schema';
import { ownedAccountIds } from './categories';
import { getDb } from './db';
import { confirmEntry } from './entries';
import { notifyLedgerChange } from './events';
import { deleteTransaction } from './ledger';
import { loadTransactions, SqliteLedgerStore, writeTransaction } from './ledger-store';
import { kvGet, kvSet } from './kv';

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

/** UPI apps to offer by name (decision 0003). Any other app is reached through Android's chooser. */
export const UPI_APPS = [
  { name: 'Google Pay', pkg: 'com.google.android.apps.nbu.paisa.user' },
  { name: 'PhonePe', pkg: 'com.phonepe.app' },
  { name: 'slice', pkg: 'indwin.c3.shareapp' },
  { name: 'iMobile (ICICI)', pkg: 'com.csam.icici.bank.imobile' },
  { name: 'HDFC Bank', pkg: 'com.snapwork.hdfc' },
  { name: 'YONO SBI', pkg: 'com.sbi.lotusintouch' },
  { name: 'HSBC India', pkg: 'com.hsbc.hsbcindia' },
  { name: 'Paytm', pkg: 'net.one97.paytm' },
  { name: 'BHIM', pkg: 'in.org.npci.upiapp' },
] as const;

const LAST_APP_KEY = 'pay.last_app';

export async function lastUpiApp(): Promise<string | null> {
  return kvGet(LAST_APP_KEY);
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

/** The category and account the user used last time for this payee, so a repeat payment is two taps. */
export async function lastChoiceFor(vpa: string): Promise<{ categoryId: string | null; accountId: string | null }> {
  const db = await getDb();
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const rows = db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.deletedAt), eq(transactions.kind, 'expense'), gte(transactions.occurredAt, since)))
    .orderBy(desc(transactions.occurredAt))
    .limit(500)
    .all();
  const owned = ownedAccountIds(db);
  const txs = loadTransactions(db, rows);
  const target = vpa.toLowerCase();
  const paid = txs.find((tx) =>
    tx.sources.some((s) => {
      const f = s.parsedFields as { vpa?: unknown };
      return typeof f.vpa === 'string' && f.vpa.toLowerCase() === target;
    }),
  );
  // Without a past payment to them, the account of the latest UPI debit.
  const latest = paid ?? txs.find((tx) => tx.postings.some((p) => owned.has(p.accountId) && p.amount < 0));
  const own = latest?.postings.find((p) => owned.has(p.accountId));
  const category = paid?.postings.find((p) => !owned.has(p.accountId) && p.amount > 0);
  return { categoryId: category?.accountId ?? null, accountId: own?.accountId ?? null };
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
  categoryId: string;
  accountId: string;
  note: string | null;
  /** Null lets Android choose. */
  appPackage: string | null;
}): Promise<PaymentResult> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Enter an amount above zero');
  if (input.payment.amount !== undefined && input.payment.amount !== input.amount) throw new Error('This QR code fixes the amount');
  const db = await getDb();
  if (!ownedAccountIds(db).has(input.accountId)) throw new Error('Pick one of your accounts');
  const id = Crypto.randomUUID();
  // Our own reference, unless the shop's QR carries one (it may be signed, and the shop matches on it).
  const reference = input.payment.reference ?? `MP${id.replace(/-/g, '').slice(0, 20).toUpperCase()}`;
  const note = input.note?.trim() || input.payment.note || undefined;
  const app = UPI_APPS.find((a) => a.pkg === input.appPackage);
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
    categoryReason: 'user',
    categoryRuleId: null,
    userSetFields: ['category', 'counterparty'],
    note: note ?? null,
    postings: [
      { id: Crypto.randomUUID(), accountId: input.accountId, amount: -input.amount as Paise },
      { id: Crypto.randomUUID(), accountId: input.categoryId, amount: input.amount },
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
          app: app?.name ?? 'Android chooser',
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
      packageName: input.appPackage ?? undefined,
    });
    const response = parseUpiResponse(responseText(result));
    status = response.status;
    fields = { status, responseCode: response.responseCode ?? null, txnId: response.txnId ?? null, approvalRef: response.approvalRef ?? null };
  } catch (e) {
    await deleteTransaction(id);
    throw new Error(`${app?.name ?? 'No UPI app'} didn't open. ${e instanceof Error ? e.message : ''}`.trim());
  }
  if (input.appPackage) await kvSet(LAST_APP_KEY, input.appPackage);

  // The SMS may have merged in while the UPI app was open; build on the entry as it is now.
  const [current] = loadTransactions(db, db.select().from(transactions).where(eq(transactions.id, id)).all());
  if (!current) return { transactionId: id, status };
  writeTransaction(db, {
    ...current,
    sources: current.sources.map((s) => (s.kind === 'app_payment' ? { ...s, parsedFields: { ...s.parsedFields, ...fields } } : s)),
    ...(status === 'success' && current.reviewReason === 'payment_unconfirmed' ? { status: 'confirmed' as const, reviewReason: null } : {}),
  });
  notifyLedgerChange();
  const smsArrived = current.sources.some((s) => s.kind === 'sms');
  if (status === 'failure' && !smsArrived) await deleteTransaction(id);
  return { transactionId: id, status: smsArrived ? 'success' : status };
}

/** The user's answer to "Did it go through?" when the UPI app didn't say. */
export async function settleUnconfirmed(transactionId: string, wentThrough: boolean): Promise<void> {
  if (wentThrough) await confirmEntry(transactionId);
  else await deleteTransaction(transactionId);
}
