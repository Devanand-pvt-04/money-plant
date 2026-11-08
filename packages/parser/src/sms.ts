import { paise, parseRupees } from '@money-plant/core';
import {
  amountOrNull,
  cleanCounterparty,
  extractAccountLast,
  extractAmounts,
  extractChannel,
  extractCounterparty,
  extractDirection,
  extractInstrument,
  extractReference,
  extractVpa,
  isRefund,
  ignoreReason,
  lastDigits,
} from './extract';
import { identifyBankSender, isBusinessSender, looksLikeMoney } from './senders';
import { TEMPLATES } from './templates';
import type { BankId, ParsedTransaction, SmsInput, SmsParseResult } from './types';

const TEMPLATE_CONFIDENCE = 0.95;
const GENERIC_CONFIDENCE = 0.75;
/** Generic parses missing the account digits need the user to say which account it was. */
const GENERIC_NO_ACCOUNT_CONFIDENCE = 0.5;
/** A sender without tuned rules: the user links it to an account before its entries count (CAP-11). */
const UNKNOWN_SENDER_CONFIDENCE = 0.6;

/**
 * Turns a bank SMS into transaction fields. Pure and synchronous; the message
 * text is never stored or returned, only the fields read from it.
 */
export function parseSms(input: SmsInput): SmsParseResult {
  const bank = identifyBankSender(input.sender);
  if (!bank) return { status: 'ignored', reason: 'unknown_sender' };
  return parseBankText(bank, input.body);
}

/**
 * CAP-11: any business sender. Known banks use their tuned rules; anyone
 * else goes through the general reader with `bank` null. Phone numbers are
 * never read.
 */
export function parseAnySms(input: SmsInput): SmsParseResult {
  if (!isBusinessSender(input.sender)) return { status: 'ignored', reason: 'unknown_sender' };
  return parseBankText(identifyBankSender(input.sender), input.body);
}

/**
 * Like parseSms, for text already known to come from `bank` (tests, the
 * paste-a-message screen), or with null from a sender without tuned rules.
 */
export function parseBankText(bank: BankId | null, rawBody: string): SmsParseResult {
  const body = rawBody.replace(/\r\n?/g, '\n').trim();
  const ignored = ignoreReason(body);
  if (ignored) return { status: 'ignored', reason: ignored };

  const amounts = extractAmounts(body);
  const fromTemplate = bank ? matchTemplate(bank, body, amounts) : null;
  if (fromTemplate) return { status: 'parsed', transaction: fromTemplate };

  // CAP-10: "USD 25.00 spent on your card": the amount in that currency, converted on the phone.
  const foreign = amounts.amount === null ? amounts.foreign : null;
  if (amounts.amount === null && !foreign) {
    // A bank message that mentions money we couldn't read is a parser gap; one with no money at all is just a notice.
    return /\b(?:Rs\.?|INR|₹)\s*\d/i.test(body) || (!bank && looksLikeMoney(body))
      ? { status: 'failed', reason: 'unreadable_amount' }
      : { status: 'ignored', reason: 'no_amount' };
  }
  const amount = foreign ? paise(foreign.amount) : amounts.amount!;
  if (amount === 0) return { status: 'ignored', reason: 'no_amount' };
  const direction = extractDirection(body);
  if (!direction) return { status: 'failed', reason: 'no_direction' };

  const instrument = extractInstrument(body, amounts);
  const accountLast = extractAccountLast(body, instrument);
  const vpa = extractVpa(body);
  return {
    status: 'parsed',
    transaction: {
      bank,
      direction,
      amount,
      instrument,
      accountLast,
      counterparty: extractCounterparty(body) ?? vpa,
      vpa,
      reference: extractReference(body),
      balance: instrument === 'credit_card' ? null : amounts.balance,
      availableLimit: amounts.availableLimit,
      channel: extractChannel(body, instrument),
      template: 'generic',
      confidence: !bank ? UNKNOWN_SENDER_CONFIDENCE : accountLast ? GENERIC_CONFIDENCE : GENERIC_NO_ACCOUNT_CONFIDENCE,
      refund: isRefund(body, direction),
      ...(foreign ? { currency: foreign.currency } : {}),
    },
  };
}

function matchTemplate(bank: BankId, body: string, amounts: ReturnType<typeof extractAmounts>): ParsedTransaction | null {
  for (const template of TEMPLATES) {
    if (template.bank !== bank) continue;
    const groups = template.pattern.exec(body)?.groups;
    if (!groups) continue;
    const amount = parseRupees(groups.amount!);
    if (amount === null || amount <= 0) continue;

    const balance = amountOrNull(groups.bal) ?? amounts.balance;
    const availableLimit = amountOrNull(groups.limit) ?? amounts.availableLimit;
    let instrument = template.instrument;
    if (instrument === 'card') {
      instrument = availableLimit !== null ? 'credit_card' : balance !== null ? 'debit_card' : 'card';
    }
    const vpa = groups.vpa?.toLowerCase() ?? extractVpa(body);
    const counterparty = (groups.cp ? cleanCounterparty(groups.cp) : null) ?? vpa;
    return {
      bank,
      direction: template.direction,
      amount,
      instrument,
      accountLast: groups.last ? lastDigits(groups.last) : extractAccountLast(body, instrument),
      counterparty,
      vpa,
      reference: groups.ref?.toUpperCase() ?? extractReference(body),
      balance: instrument === 'credit_card' ? null : balance,
      availableLimit,
      channel: extractChannel(body, instrument),
      template: template.id,
      confidence: TEMPLATE_CONFIDENCE,
      refund: isRefund(body, template.direction),
    };
  }
  return null;
}
