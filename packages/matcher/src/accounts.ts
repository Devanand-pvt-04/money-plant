import { BANK_NAMES, type BankId, type ParsedTransaction } from '@money-plant/parser';
import type { LedgerAccount, NewLedgerAccount } from './types';

/** Which supported bank an account's free-text institution refers to. */
export function institutionBank(institution: string | null): BankId | null {
  if (!institution) return null;
  const text = institution.toLowerCase();
  if (text.includes('hdfc')) return 'hdfc';
  if (text.includes('icici')) return 'icici';
  if (text.includes('hsbc')) return 'hsbc';
  if (/\bsbi\b|state bank/.test(text)) return 'sbi';
  if (text.includes('slice')) return 'slice';
  return null;
}

/** "234" (ICICI prints 3 digits) matches an account ending "1234", and the other way round. */
export function digitsMatch(a: string, b: string): boolean {
  return a.length >= 3 && b.length >= 3 && (a.endsWith(b) || b.endsWith(a));
}

export type AccountResolution =
  | { account: LedgerAccount; certain: boolean; upgradeLast4?: string }
  | { create: NewLedgerAccount; certain: boolean };

/**
 * Finds the user's account or card that a message is about, or describes the
 * one to create. `certain` is false when the pipeline had to guess, which sends
 * the entry to the review inbox.
 */
export function resolveAccount(parsed: ParsedTransaction, accounts: readonly LedgerAccount[]): AccountResolution {
  const bank = parsed.bank;
  const bankName = bank ? BANK_NAMES[bank] : 'Unknown bank';
  const ofBank = accounts.filter((account) => bank !== null && institutionBank(account.institution) === bank);
  const banks = ofBank.filter((account) => account.type === 'bank');
  const cards = ofBank.filter((account) => account.type === 'credit_card');
  const last = parsed.accountLast;

  const byDigits = (pool: readonly LedgerAccount[]) =>
    last === null ? [] : pool.filter((account) => account.last4 !== null && digitsMatch(account.last4, last));
  const found = (account: LedgerAccount, certain = true): AccountResolution => ({
    account,
    certain,
    // Learn the 4th digit when ICICI's 3-digit account later shows up in full.
    ...(last && account.last4 && last.length > account.last4.length ? { upgradeLast4: last } : {}),
  });

  switch (parsed.instrument) {
    case 'credit_card': {
      const [match] = byDigits(cards);
      if (match) return found(match);
      break;
    }
    case 'account': {
      const [match] = byDigits(banks);
      if (match) return found(match);
      break;
    }
    case 'debit_card': {
      // Debit cards have their own number; the money is in the linked bank account.
      const [match] = byDigits(banks);
      if (match) return found(match);
      if (banks.length === 1) return found(banks[0]!);
      break;
    }
    case 'card': {
      const [match] = [...byDigits(cards), ...byDigits(banks)];
      if (match) return found(match);
      break;
    }
  }

  if (last === null) {
    // Generic parse without digits: use the only account of the right kind, if there is one.
    const pool = parsed.instrument === 'credit_card' ? cards : banks;
    if (pool.length === 1) return found(pool[0]!, false);
    const placeholder = accounts.find((account) => account.name === `${bankName} (unknown account)`);
    if (placeholder) return found(placeholder, false);
    return {
      create: { type: 'bank', name: `${bankName} (unknown account)`, institution: bankName, last4: null },
      certain: false,
    };
  }

  const isCard = parsed.instrument === 'credit_card' || parsed.instrument === 'card';
  return {
    create: {
      type: isCard ? 'credit_card' : 'bank',
      name: isCard ? `${bankName} card ••${last}` : `${bankName} ••${last}`,
      institution: bankName,
      last4: last,
    },
    // A card we can't tell is credit or debit is a guess.
    certain: parsed.instrument !== 'card',
  };
}

const BUSINESS_WORDS =
  /\b(?:pvt|private|ltd|limited|llp|inc|corp|co|company|store|stores|mart|shop|foods?|restaurant|cafe|hotel|services?|solutions|technologies|tech|india|bank|pay|payments|recharge|enterprises?|traders?|agency|retail|online|digital|ventures|industries|medical|pharma(?:cy)?|hospital|clinic|petrol|fuel|station|motors|travels?|tours|insurance|finance|fintech|securities|broking|mutual|fund|electricity|gas|water|broadband|telecom|jio|airtel|vodafone|swiggy|zomato|amazon|flipkart|uber|ola|rapido|netflix|spotify|google|apple|neft|imps|rtgs|upi|salary|interest|transfer|cash)\b/i;

/**
 * Payments to people need the user's input (CAT-4), so they go to review.
 * A phone-number VPA, or a 2 to 4 word name with no business words, counts as a person.
 */
export function looksLikePerson(parsed: Pick<ParsedTransaction, 'channel' | 'counterparty' | 'vpa'>): boolean {
  if (parsed.channel !== 'upi') return false;
  if (parsed.vpa && /^\d{10}(?:-\d)?@/.test(parsed.vpa)) return true;
  const name = parsed.counterparty;
  if (!name || name.includes('@') || /\d/.test(name)) return false;
  if (BUSINESS_WORDS.test(name)) return false;
  const words = name.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[a-z.]+$/i.test(word));
}
