import { parseRupees, type Paise } from '@money-plant/core';
import type { Channel, Direction, IgnoreReason, Instrument } from './types';

/**
 * Field extractors shared by the bank templates and the generic parser. Each
 * one works on the whole message and returns null when it finds nothing.
 */

const AMOUNT = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const CURRENCY_AMOUNT = new RegExp(String.raw`(?:\bRs\.?|\bINR|₹)\s*` + AMOUNT, 'gi');
// SBI writes some amounts without a currency: "debited by 450.0".
const BARE_AMOUNT = new RegExp(String.raw`\b(?:debited|credited)\s+(?:by|for|with)\s+` + AMOUNT, 'i');
const BALANCE_BEFORE = /(?:bal(?:ance)?|avbl|avl)[^0-9a-z]{0,4}(?:is|of)?[^0-9a-z]{0,4}$/i;
const LIMIT_BEFORE = /(?:limit|lmt)[^0-9a-z]{0,4}(?:is|of)?[^0-9a-z]{0,4}$/i;
const NOT_TXN_AMOUNT_BEFORE = /(?:due|min(?:imum)?|outstanding|limit of|up ?to|upto)[^0-9a-z]{0,6}(?:amount)?[^0-9a-z]{0,4}(?:is|of)?[^0-9a-z]{0,4}$/i;

export interface Amounts {
  amount: Paise | null;
  balance: Paise | null;
  availableLimit: Paise | null;
}

/** Splits the amounts in a message into the transaction amount, balance and available limit. */
export function extractAmounts(text: string): Amounts {
  const result: Amounts = { amount: null, balance: null, availableLimit: null };
  for (const match of text.matchAll(CURRENCY_AMOUNT)) {
    const value = parseRupees(match[1]!);
    if (value === null) continue;
    const before = text.slice(Math.max(0, match.index - 30), match.index);
    if (LIMIT_BEFORE.test(before)) result.availableLimit ??= value;
    else if (BALANCE_BEFORE.test(before)) result.balance ??= value;
    else if (!NOT_TXN_AMOUNT_BEFORE.test(before)) result.amount ??= value;
  }
  if (result.amount === null) {
    const bare = BARE_AMOUNT.exec(text);
    if (bare) result.amount = parseRupees(bare[1]!);
  }
  return result;
}

export function amountOrNull(text: string | undefined): Paise | null {
  return text === undefined ? null : parseRupees(text);
}

const DEBIT_WORDS = /\b(?:debited|debit of|spent|sent|withdrawn|withdrawal of|paid|purchase|deducted|used for|txn of|transaction of)\b/i;
const CREDIT_WORDS = /\b(?:credited|received|deposited|refund(?:ed)?|reversed|reversal of|added to)\b/i;

/** Debit or credit, whichever keyword comes first. "Acct debited; SWIGGY credited" is a debit. */
export function extractDirection(text: string): Direction | null {
  const debit = DEBIT_WORDS.exec(text);
  const credit = CREDIT_WORDS.exec(text);
  if (debit && credit) return debit.index <= credit.index ? 'debit' : 'credit';
  if (debit) return 'debit';
  if (credit) return 'credit';
  return null;
}

export function extractInstrument(text: string, amounts: Amounts): Instrument {
  if (/credit\s*card/i.test(text)) return 'credit_card';
  if (/debit\s*card/i.test(text)) return 'debit_card';
  if (/\bcard\b/i.test(text)) {
    if (amounts.availableLimit !== null) return 'credit_card';
    if (amounts.balance !== null) return 'debit_card';
    return 'card';
  }
  return 'account';
}

const CARD_DIGITS = /\bcard\s*(?:no\.?\s*)?(?:ending\s*(?:with|in)?\s*|number\s*)?[:\-]?\s*[xX*•.]*\s*(\d{4})\b/i;
const ACCOUNT_DIGITS = /\b(?:a\/c|a\/c\.|ac|acct|account)\s*(?:no\.?|number)?\s*[:\-]?\s*[xX*•.]*\s*(\d{3,})\b/i;
const BANK_DIGITS = /\bbank\s+(?:a\/c\s*)?[xX*]+(\d{3,4})\b/i;

/** Last 3 or 4 digits of the user's account or card. The first one in the message is the user's. */
export function extractAccountLast(text: string, instrument: Instrument): string | null {
  const patterns = instrument === 'account' ? [ACCOUNT_DIGITS, BANK_DIGITS, CARD_DIGITS] : [CARD_DIGITS, ACCOUNT_DIGITS, BANK_DIGITS];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return lastDigits(match[1]!);
  }
  return null;
}

export function lastDigits(digits: string): string {
  return digits.length > 4 ? digits.slice(-4) : digits;
}

const UPI_REF = /\bUPI\s*(?:Ref(?:\.|erence)?\s*)?(?:No\.?|#|ID)?\s*[:\-]?\s*(\d{12})\b/i;
const OTHER_REF = /\b(?:Ref(?:erence)?|RRN|UTR|IMPS Ref|NEFT Ref|Txn\s*(?:ID|No)|Transaction\s*(?:ID|No))\.?\s*(?:No\.?|Number|#|ID)?\s*[:\-]?\s*([A-Z0-9]{8,22})\b/i;

export function extractReference(text: string): string | null {
  const match = UPI_REF.exec(text) ?? OTHER_REF.exec(text);
  return match ? match[1]!.toUpperCase() : null;
}

const VPA = /\b([a-zA-Z0-9][a-zA-Z0-9.\-_]{1,255}@[a-zA-Z]{2,64})(?![\w@]|\.[a-zA-Z])/;

export function extractVpa(text: string): string | null {
  const match = VPA.exec(text);
  return match ? match[1]!.toLowerCase() : null;
}

const STOP = String.raw`(?=\s*\(|\s+on\b|\s+On\b|\s+for\b|\.\s|\.$|\s*\n|\s+UPI\b|\s+Ref|\s+Avl|\s+Bal\b|\s+IMPS\b|\s+NEFT\b|,|;|$)`;
const COUNTERPARTY_PATTERNS: readonly RegExp[] = [
  /\bto\s+VPA\s+([\w.\-]+@[a-z]+)/i,
  /\btrf\s+to\s+([^\n]+?)(?=\s+Ref|\s+on\b|\.|$)/i,
  /\btransfer\s+from\s+([^\n]+?)(?=\s+Ref|\s+on\b|\.|$)/i,
  /;\s*([^;\n]+?)\s+credited\b/i,
  new RegExp(String.raw`\bat\s+([^\n]+?)` + STOP, 'i'),
  // "debited ... towards NETFLIX for e-mandate": the payee of an autopay or bill payment.
  new RegExp(String.raw`\btowards\s+([^\n]+?)` + STOP, 'i'),
  new RegExp(String.raw`\bfrom\s+([^\n]+?)` + STOP, 'gi'),
  new RegExp(String.raw`\bto\s+([^\n]+?)` + STOP, 'gi'),
  /\bInfo:?\s*([^\n]+?)(?=\.\s|\.$|\s+Avl|$)/i,
];

/** Merchant or person on the other side of the payment, as printed in the message. */
export function extractCounterparty(text: string): string | null {
  for (const pattern of COUNTERPARTY_PATTERNS) {
    const matches = pattern.global ? [...text.matchAll(pattern)] : [pattern.exec(text)];
    for (const match of matches) {
      if (!match) continue;
      const cleaned = cleanCounterparty(match[1]!);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/** Trims a captured counterparty and rejects captures that are really the user's own account. */
export function cleanCounterparty(raw: string): string | null {
  const value = raw.replace(/\s+/g, ' ').replace(/^[\s:\-]+|[\s.,:;\-]+$/g, '');
  if (value.length < 2) return null;
  if (/^(?:your\s+)?(?:hdfc|icici|sbi|hsbc)?\s*(?:bank\s+)?(?:savings\s+|current\s+|salary\s+)?(?:a\/c|ac\b|acct|account|card|credit card|debit card)/i.test(value)) return null;
  // "ICICI Bank Savings Account XX798": a masked number after an account word is the user's own account.
  if (/\b(?:a\/c|acct|account|card)\s*(?:no\.?\s*)?[xX*]+\d{3,4}\b/i.test(value)) return null;
  if (/^(?:a\/c|account) linked to|^mobile|^your\b|^\d+$|^date\b/i.test(value)) return null;
  return value.slice(0, 60);
}

export function extractChannel(text: string, instrument: Instrument): Channel {
  if (/\bUPI\b|VPA/i.test(text)) return 'upi';
  if (/\bNEFT\b/i.test(text)) return 'neft';
  if (/\bIMPS\b/i.test(text)) return 'imps';
  if (/\bRTGS\b/i.test(text)) return 'rtgs';
  if (/\bATM\b|cash withdrawal/i.test(text)) return 'atm';
  if (instrument !== 'account') return 'card';
  return 'other';
}

const MANDATE_CHANGE = /\b(?:e-?)?mandate\b(?:[^.]|\.\d){0,120}?\b(?:created|registered|set ?up|activated|approved|revoked|cancell?ed|paused|resumed|modified|updated)\b|\bauto ?pay\b(?:[^.]|\.\d){0,120}?\b(?:created|registered|set ?up|activated|revoked|cancell?ed|paused|resumed|modified)\b/i;
const MONEY_MOVED = /\b(?:debited|credited|deducted|spent|withdrawn|has been paid|was paid)\b/i;

/** Messages from bank senders that are not completed transactions. */
export function ignoreReason(text: string): IgnoreReason | null {
  if (/\bOTP\b|one[- ]time password|verification code|\bCVV\b/i.test(text)) return 'otp';
  if (/\b(?:declined|failed|unsuccessful|could not be (?:processed|completed)|was not (?:processed|completed)|insufficient)\b/i.test(text)) return 'failed_payment';
  if (/\b(?:has requested|requested money|collect request|request(?:ed)? (?:of|for) (?:Rs|INR|₹))/i.test(text)) return 'request';
  if (/\b(?:will be|shall be|is scheduled to be|to be) (?:auto-?)?(?:debited|deducted|charged)\b|\bpre-?debit\b|\b(?:is|are) due\b|\bdue (?:date|on|by)\b|\bminimum (?:amount )?due\b|\btotal (?:amount )?due\b|\bstatement (?:for|of|is)\b|\bupcoming\b/i.test(text)) return 'reminder';
  // Setting up, changing or cancelling an autopay mandate moves no money; the debits come as their own messages.
  if (MANDATE_CHANGE.test(text) && !MONEY_MOVED.test(text)) return 'reminder';
  if (/\b(?:pre-?approved|offer|eligible|apply now|click here to (?:apply|avail)|loan (?:of|up ?to)|lowest (?:emi|rate)|win |congratulations|reward points? (?:worth|expir))/i.test(text)) return 'promotion';
  return null;
}
