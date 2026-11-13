import { parseRupees, type Paise } from '@money-plant/core';
import { extractAccountLast, lastDigits } from './extract';
import { extractDate } from './predebit';
import { identifyBankSender } from './senders';
import type { BankId, SmsInput } from './types';

/**
 * Decision 0024: a credit card's statement or bill-due message, for any bank.
 * "Your HDFC Bank Credit Card ending 5678 statement is ready. Total due
 * Rs.12,400.00, minimum due Rs.620.00. Pay by 05-11-2026." Like every parsed
 * message, only these fields leave the parser.
 */
export interface ParsedCardStatement {
  bank: BankId | null;
  /** The card's last 4 digits, when printed. */
  last4: string | null;
  /** What the card owed on the statement date. */
  totalDue: Paise;
  minimumDue: Paise | null;
  /** "2026-11-05", when printed. */
  dueDate: string | null;
  /** "2026-10-18", when printed; otherwise the phone uses the card's statement day or the day it arrived. */
  statementDate: string | null;
  /** A statement says the bill is new; a reminder only repeats what is due. */
  kind: 'statement' | 'reminder';
}

const CARD = /\b(?:credit\s*card|card\s*(?:ending|no\.?|number|xx|x+\d|\*+\d)|CC\b)/i;
const STATEMENT = /\bstatement\b|\bbill(?:ed)?\s+(?:is\s+)?(?:generated|ready)\b/i;
const MONEY = String.raw`(?:Rs\.?|INR|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;
const TOTAL_DUE = new RegExp(String.raw`\b(?:total\s+(?:amount\s+)?(?:due|payable|outstanding)|statement\s+(?:amount|balance)|amount\s+due|outstanding(?:\s+amount)?)\b[^0-9₹]{0,24}?` + MONEY, 'i');
const MINIMUM_DUE = new RegExp(String.raw`\bmin(?:imum)?\.?\s+(?:amount\s+)?due\b[^0-9₹]{0,24}?` + MONEY, 'i');
const PAYMENT_DUE = new RegExp(String.raw`\bpayment\s+of\s+` + MONEY + String.raw`[^.]{0,60}?\bis\s+due\b`, 'i');
const DUE_DATE = /\b(?:due\s+(?:date|on|by)|pay(?:able)?\s+(?:by|before|on\s+or\s+before)|is\s+due\s+on|due\s*:)\s*[:\-]?\s*([0-9A-Za-z\s\-/.,]{6,20})/i;
const STATEMENT_DATE = /\bstatement\s+(?:date|dated|generated\s+on|as\s+on|for\s+(?:the\s+)?period\s+[^.]*?\s+to)\s*[:\-]?\s*([0-9A-Za-z\s\-/.,]{6,20})/i;

/** Reads a card statement or bill-due message from a bank sender. Null for anything else. */
export function parseCardStatement(input: SmsInput, now: Date): ParsedCardStatement | null {
  return parseCardStatementText(identifyBankSender(input.sender), input.body, now);
}

export function parseCardStatementText(bank: BankId | null, rawBody: string, now: Date): ParsedCardStatement | null {
  const body = rawBody.replace(/\s+/g, ' ').trim();
  if (!CARD.test(body)) return null;
  // A payment or a spend is a transaction, not a statement.
  if (/\b(?:has been received|received (?:on|towards)|spent|debited|credited|reversed|refund)\b/i.test(body)) return null;
  const total = TOTAL_DUE.exec(body) ?? PAYMENT_DUE.exec(body);
  const totalDue = total ? parseRupees(total[1]!) : null;
  if (totalDue === null || totalDue < 0) return null;
  const minimum = MINIMUM_DUE.exec(body);
  const due = DUE_DATE.exec(body);
  const printed = STATEMENT_DATE.exec(body);
  const statement = STATEMENT.test(body);
  const last = extractAccountLast(body, 'credit_card');
  return {
    bank,
    last4: last ? lastDigits(last) : null,
    totalDue,
    minimumDue: minimum ? parseRupees(minimum[1]!) : null,
    dueDate: due ? extractDate(due[1]!, now) : null,
    statementDate: printed ? extractDate(printed[1]!, now) : null,
    kind: statement ? 'statement' : 'reminder',
  };
}
