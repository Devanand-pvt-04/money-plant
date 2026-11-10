import type { BankId } from './types';

/**
 * Indian commercial SMS come from headers like "VM-HDFCBK", "AX-ICICIT" or,
 * since TRAI's 2025 suffix rule, "JD-HDFCBK-S". This strips the operator
 * prefix and the category suffix, leaving "HDFCBK".
 */
export function normaliseSender(address: string): string {
  return address
    .trim()
    .toUpperCase()
    .replace(/^[A-Z0-9]{2}-/, '')
    .replace(/-[A-Z]$/, '');
}

/** Same company, not a bank account or card: insurance, mutual funds, broking. */
const NON_BANK = /MF|AMC|LIF|LIFE|ERGO|PRU|LOMBRD|LOMBAR|GEN|INS|SEC|DIRECT|^HDFCLI$|^ICICIP$|^PNB(?:HFL|HOU|MET)/;

const BANK_PATTERNS: readonly [BankId, RegExp][] = [
  ['hdfc', /HDFC/],
  ['icici', /ICICI/],
  ['hsbc', /HSBC/],
  // Checked after HSBC: "HSBC" doesn't contain "SBI", but keep the order explicit.
  ['sbi', /SBI/],
  // Punjab National Bank: "PNBSMS", "PUNBNK". Its housing finance and MetLife arms are in NON_BANK.
  ['pnb', /PNB|PUNB/],
  ['slice', /SLICE|SLCEIT/],
];

/**
 * Substrings the native SMS reader uses to pick candidate senders before any
 * text reaches JavaScript. Kept loose; `identifyBankSender` makes the final call.
 */
export const BANK_SENDER_TOKENS: readonly string[] = ['HDFC', 'ICICI', 'HSBC', 'SBI', 'SLICE', 'SLCEIT'];

/** A person's phone number: never read (CAP-11). Short codes of up to 6 digits are businesses. */
export function isPhoneNumber(address: string): boolean {
  const compact = address.trim().replace(/[\s-]/g, '');
  return /^\+?\d{7,}$/.test(compact);
}

/**
 * CAP-11: any business sender, not a fixed list: an alphanumeric header
 * ("VM-AXISBK", "ENBD", "Revolut") or a short code of up to 6 digits.
 */
export function isBusinessSender(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed || isPhoneNumber(trimmed)) return false;
  return /^\d{3,6}$/.test(trimmed) || /[A-Za-z]/.test(trimmed);
}

/**
 * Words that say money moved. The native receiver has a copy in
 * Allowlists.kt (a test checks they match), and reads only messages with
 * one of these and an amount (CAP-11, CAP-12).
 */
export const MONEY_WORDS: readonly string[] = [
  'debited', 'credited', 'spent', 'paid', 'received', 'withdrawn', 'withdrawal', 'purchase', 'deducted',
  'sent', 'deposited', 'transferred', 'refund', 'refunded', 'reversed', 'charged', 'payment', 'txn', 'transaction',
];

const MONEY_WORD = new RegExp(String.raw`\b(?:${MONEY_WORDS.join('|')})\b`, 'i');
// A number with a currency next to it: "Rs 450", "₹450", "$12.40", "AED 1,250.00", "1.234,56 EUR".
const TAGGED_AMOUNT = /(?:\b(?:rs|inr|[a-z]{3})\.?|[₹$€£¥])\s?\d|\d[\d,.]*\s?(?:\b[a-z]{3}\b|[₹$€£¥])/i;

/** What the native filter checks before any JavaScript sees a message: an amount and a money word. */
export function looksLikeMoney(text: string): boolean {
  return MONEY_WORD.test(text) && TAGGED_AMOUNT.test(text);
}

/** Which supported bank sent this SMS, or null for anyone else (including people). */
export function identifyBankSender(address: string): BankId | null {
  const header = normaliseSender(address);
  // Phone numbers are people, never bank alerts.
  if (/^\+?\d+$/.test(header)) return null;
  if (NON_BANK.test(header)) return null;
  for (const [bank, pattern] of BANK_PATTERNS) {
    if (pattern.test(header)) return bank;
  }
  return null;
}

/** Android package names of UPI and bank apps whose notifications we read (CAP-3). */
export const UPI_APP_PACKAGES: Readonly<Record<string, string>> = {
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'com.phonepe.app': 'PhonePe',
  'com.csam.icici.bank.imobile': 'iMobile',
  'com.snapwork.hdfc': 'HDFC Bank',
  'com.sbi.lotusintouch': 'YONO SBI',
  'com.sbi.upi': 'BHIM SBI Pay',
  'com.hsbc.hsbcindia': 'HSBC India',
  'indwin.c3.shareapp': 'slice',
  'net.one97.paytm': 'Paytm',
  'com.dreamplug.androidapp': 'CRED',
  'in.org.npci.upiapp': 'BHIM',
  'com.naviapp': 'Navi',
  'money.super.payments': 'super.money',
  'in.amazon.mShop.android.shopping': 'Amazon Pay',
};
