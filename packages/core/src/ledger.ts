import { DEFAULT_CURRENCY, type CurrencyCode } from './currency';
import type { Paise } from './money';

export const ACCOUNT_TYPES = [
  'bank',
  'cash',
  'wallet',
  'credit_card',
  'loan',
  'fd',
  'rd',
  'mutual_fund',
  'stock',
  'nps',
  'savings_scheme',
  'person',
  'category',
  'custom',
  // Hidden: balances transfers between currencies (LED-11, decision 0017).
  'exchange',
  // Hidden: the other side of a debt settled another way, with no money moving (decision 0027).
  'settled',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Bank account',
  cash: 'Cash',
  wallet: 'Wallet',
  credit_card: 'Credit card',
  loan: 'Loan',
  fd: 'Fixed deposit',
  rd: 'Recurring deposit',
  mutual_fund: 'Mutual fund',
  stock: 'Stocks',
  nps: 'NPS',
  savings_scheme: 'Savings scheme',
  person: 'Person',
  category: 'Category',
  custom: 'Custom',
  exchange: 'Currency exchange',
  settled: 'Settled outside the app',
};

/**
 * Account types the user creates directly. People and categories come from
 * other flows; `custom` accounts are created from a user-defined account type (ACC-6).
 */
export const USER_ACCOUNT_TYPES = ACCOUNT_TYPES.filter(
  (type) => type !== 'person' && type !== 'category' && type !== 'custom' && type !== 'exchange' && type !== 'settled',
);

/**
 * Accounts that take postings in any currency (decision 0017). Every other
 * account takes postings only in its own currency.
 */
export const ANY_CURRENCY_TYPES: ReadonlySet<AccountType> = new Set(['person', 'category', 'exchange', 'settled']);

/** Built-in types whose balance is money owed rather than money held. */
export const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set(['credit_card', 'loan']);

/** ACC-6: a custom account type sits on one of these fixed classes. */
export type AccountClass = 'asset' | 'liability';

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export interface Posting {
  accountId: string;
  /** Minor units of `currency`. */
  amount: Paise;
  /** INR when left out. */
  currency?: CurrencyCode;
}

export type PostingError =
  | { code: 'too_few_postings' }
  | { code: 'not_integer'; index: number }
  | { code: 'zero_amount'; index: number }
  | { code: 'unbalanced'; sum: number; currency: CurrencyCode };

/**
 * A transaction is valid when it has at least two non-zero integer postings
 * that sum to zero in each currency. Returns the first problem found, or null.
 */
export function validatePostings(postings: readonly Posting[]): PostingError | null {
  if (postings.length < 2) return { code: 'too_few_postings' };
  const sums = new Map<CurrencyCode, number>();
  for (const [index, posting] of postings.entries()) {
    if (!Number.isSafeInteger(posting.amount)) return { code: 'not_integer', index };
    if (posting.amount === 0) return { code: 'zero_amount', index };
    const currency = posting.currency ?? DEFAULT_CURRENCY;
    sums.set(currency, (sums.get(currency) ?? 0) + posting.amount);
  }
  for (const [currency, sum] of sums) {
    if (sum !== 0) return { code: 'unbalanced', sum, currency };
  }
  return null;
}

/** Balance of one account: its opening balance plus every posting to it. */
export function balanceOf(
  accountId: string,
  openingBalance: Paise,
  postings: readonly Posting[],
): Paise {
  let balance: number = openingBalance;
  for (const posting of postings) {
    if (posting.accountId === accountId) balance += posting.amount;
  }
  return balance as Paise;
}
