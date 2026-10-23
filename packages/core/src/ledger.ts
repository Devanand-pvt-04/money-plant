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
  'person',
  'category',
  'custom',
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
  person: 'Person',
  category: 'Category',
  custom: 'Custom',
};

/**
 * Account types the user creates directly. People and categories come from
 * other flows; `custom` accounts are created from a user-defined account type (ACC-6).
 */
export const USER_ACCOUNT_TYPES = ACCOUNT_TYPES.filter(
  (type) => type !== 'person' && type !== 'category' && type !== 'custom',
);

/** Built-in types whose balance is money owed rather than money held. */
export const LIABILITY_TYPES: ReadonlySet<AccountType> = new Set(['credit_card', 'loan']);

/** ACC-6: a custom account type sits on one of these fixed classes. */
export type AccountClass = 'asset' | 'liability';

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export interface Posting {
  accountId: string;
  amount: Paise;
}

export type PostingError =
  | { code: 'too_few_postings' }
  | { code: 'not_integer'; index: number }
  | { code: 'zero_amount'; index: number }
  | { code: 'unbalanced'; sum: number };

/**
 * A transaction is valid when it has at least two non-zero integer postings
 * that sum to zero. Returns the first problem found, or null.
 */
export function validatePostings(postings: readonly Posting[]): PostingError | null {
  if (postings.length < 2) return { code: 'too_few_postings' };
  let sum = 0;
  for (const [index, posting] of postings.entries()) {
    if (!Number.isSafeInteger(posting.amount)) return { code: 'not_integer', index };
    if (posting.amount === 0) return { code: 'zero_amount', index };
    sum += posting.amount;
  }
  return sum === 0 ? null : { code: 'unbalanced', sum };
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
