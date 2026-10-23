import { parseRupees, type Paise } from '@money-plant/core';
import { cleanCounterparty, extractAccountLast, extractInstrument, lastDigits } from './extract';
import { identifyBankSender } from './senders';
import type { BankId, Instrument, SmsInput } from './types';

/**
 * REC-1: a notice that an autopay will be debited soon. Banks must send one
 * before each e-mandate or standing-instruction debit (RBI), so these name the
 * payee, amount and date. Like ParsedTransaction, these fields are all that
 * leave the parser.
 */
export interface ParsedPreDebit {
  bank: BankId;
  amount: Paise;
  /** Payee as printed ("NETFLIX"), or null when the message doesn't say. */
  payee: string | null;
  /** When the debit is due, "2026-10-25". */
  dueDate: string;
  instrument: Instrument;
  accountLast: string | null;
  /** Mandate, SI or UMN reference, when printed. */
  mandateRef: string | null;
}

const FUTURE_DEBIT = /\b(?:will be|shall be|is scheduled to be|to be)\s+(?:auto[- ]?)?(?:debited|deducted|charged|paid)\b|\bauto[- ]?(?:debit|pay)\b[^.]*\bon\b|\bpre[- ]?debit\b|\bupcoming (?:auto[- ]?)?(?:debit|payment|mandate)\b/i;
const NOT_A_MANDATE = /\b(?:minimum (?:amount )?due|total (?:amount )?due|statement|OTP|declined|failed|unsuccessful)\b/i;
const AMOUNT = /(?:\bRs\.?|\bINR|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_PATTERNS: readonly RegExp[] = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
  /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/,
  /\b(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{2,4})\b/,
];
const PAYEE_PATTERNS: readonly RegExp[] = [
  /\b(?:towards|for payment to|payable to|in favou?r of|to merchant|merchant:?)\s+([^\n]+?)(?=\s+(?:on|for|via|as per|under|using|from|with|against|vide|SI|UMN|mandate|ref)\b|[.,;(]|$)/i,
  /\bfor\s+(?!your\b|the\b|standing\b|e-?mandate\b|auto)([^\n]+?)(?=\s+(?:on|via|as per|under|using|from|with|against|vide|SI|UMN|mandate|subscription|ref)\b|[.,;(]|$)/i,
  /\bto\s+(?!be\b|your\b|cancel\b|stop\b|opt\b|avoid\b|ensure\b|maintain\b)([^\n]+?)(?=\s+(?:on|for|via|as per|under|using|from|with|against|vide|SI|UMN|ref)\b|[.,;(]|$)/i,
];
const MANDATE_REF = /\b(?:UMN|SI\s*(?:ID|No\.?|Ref)|Mandate\s*(?:ID|Ref(?:erence)?|No\.?))\s*[:\-]?\s*([A-Za-z0-9@.\-]{5,39}[A-Za-z0-9])/i;

/** Reads a date written as 2026-10-25, 25-10-2026, 25/10/26 or 25-Oct-26, using `now` to place two-digit years. */
export function extractDate(text: string, now: Date): string | null {
  for (const [index, pattern] of DATE_PATTERNS.entries()) {
    const match = pattern.exec(text);
    if (!match) continue;
    let year: number;
    let month: number;
    let day: number;
    if (index === 0) {
      [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else {
      day = Number(match[1]);
      month = index === 1 ? Number(match[2]) : MONTHS.indexOf(match[2]!.toLowerCase()) + 1;
      year = Number(match[3]);
      if (year < 100) year += Math.floor(now.getFullYear() / 100) * 100;
    }
    const date = new Date(year, month - 1, day);
    if (month < 1 || date.getMonth() !== month - 1 || date.getDate() !== day) continue;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

/**
 * Reads a pre-debit notice from a bank sender. Returns null for anything else,
 * including card statements and bill-due reminders, which aren't autopays.
 * `now` is when the message arrived; a due date must not be long past it.
 */
export function parsePreDebit(input: SmsInput, now: Date): ParsedPreDebit | null {
  const bank = identifyBankSender(input.sender);
  if (!bank) return null;
  return parsePreDebitText(bank, input.body, now);
}

export function parsePreDebitText(bank: BankId, rawBody: string, now: Date): ParsedPreDebit | null {
  const body = rawBody.replace(/\s+/g, ' ').trim();
  if (!FUTURE_DEBIT.test(body) || NOT_A_MANDATE.test(body)) return null;
  const amountMatch = AMOUNT.exec(body);
  const amount = amountMatch ? parseRupees(amountMatch[1]!) : null;
  if (amount === null || amount <= 0) return null;
  const dueDate = extractDate(body, now);
  if (!dueDate) return null;
  // A notice is sent a day or a few before the debit, never long after.
  const due = new Date(`${dueDate}T00:00:00`);
  if (due.getTime() < now.getTime() - 3 * 86_400_000) return null;

  let payee: string | null = null;
  for (const pattern of PAYEE_PATTERNS) {
    const match = pattern.exec(body);
    const cleaned = match ? cleanCounterparty(match[1]!) : null;
    if (cleaned && !/\d{1,2}[-/]\w{2,3}[-/]\d{2,4}/.test(cleaned) && !AMOUNT.test(cleaned)) {
      payee = cleaned;
      break;
    }
  }
  const amounts = { amount, balance: null, availableLimit: null };
  const instrument = extractInstrument(body, amounts);
  const mandate = MANDATE_REF.exec(body);
  const accountLast = extractAccountLast(body, instrument);
  return {
    bank,
    amount,
    payee,
    dueDate,
    instrument,
    accountLast: accountLast ? lastDigits(accountLast) : null,
    mandateRef: mandate ? mandate[1]! : null,
  };
}
