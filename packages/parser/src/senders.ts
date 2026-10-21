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
const NON_BANK = /MF|AMC|LIF|LIFE|ERGO|PRU|LOMBRD|LOMBAR|GEN|INS|SEC|DIRECT|^HDFCLI$|^ICICIP$/;

const BANK_PATTERNS: readonly [BankId, RegExp][] = [
  ['hdfc', /HDFC/],
  ['icici', /ICICI/],
  ['hsbc', /HSBC/],
  // Checked after HSBC: "HSBC" doesn't contain "SBI", but keep the order explicit.
  ['sbi', /SBI/],
  ['slice', /SLICE|SLCEIT/],
];

/**
 * Substrings the native SMS reader uses to pick candidate senders before any
 * text reaches JavaScript. Kept loose; `identifyBankSender` makes the final call.
 */
export const BANK_SENDER_TOKENS: readonly string[] = ['HDFC', 'ICICI', 'HSBC', 'SBI', 'SLICE', 'SLCEIT'];

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
