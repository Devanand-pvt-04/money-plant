import type { AccountType } from '@money-plant/core';
import type { AccountBalance } from './ledger';

export type GroupKey = 'funds' | 'bank' | 'stocks' | 'deposits' | 'schemes' | 'cash' | 'other' | 'debts';

export interface AccountGroup {
  key: GroupKey;
  title: string;
  /** Where the money sits on the Accounts money card; the rest share one slice. */
  slice: 'funds' | 'bank' | 'stocks' | 'deposits' | 'rest';
  has: (b: AccountBalance) => boolean;
}

const is = (...types: AccountType[]) => (b: AccountBalance) => types.includes(b.account.type);

/** NW-1, NW-4 (decision 0015): the groups on Accounts, in order. Custom types (ACC-6) go by their class. */
export const GROUPS: readonly AccountGroup[] = [
  { key: 'funds', title: 'Mutual funds', slice: 'funds', has: is('mutual_fund') },
  { key: 'bank', title: 'Bank accounts', slice: 'bank', has: is('bank') },
  { key: 'stocks', title: 'Stocks', slice: 'stocks', has: is('stock') },
  { key: 'deposits', title: 'Deposits', slice: 'deposits', has: is('fd', 'rd') },
  { key: 'schemes', title: 'Retirement and savings schemes', slice: 'rest', has: is('nps', 'savings_scheme') },
  { key: 'cash', title: 'Cash and wallets', slice: 'rest', has: is('cash', 'wallet') },
  { key: 'other', title: 'Other investments', slice: 'rest', has: (b) => b.account.type === 'custom' && !b.liability },
  { key: 'debts', title: 'Cards and loans', slice: 'rest', has: (b) => b.account.type === 'credit_card' || b.account.type === 'loan' || (b.account.type === 'custom' && b.liability) },
];

export const groupOf = (b: AccountBalance): AccountGroup | undefined => GROUPS.find((g) => g.has(b));
export const isGroupKey = (value: string | undefined): value is GroupKey => GROUPS.some((g) => g.key === value);

/** The slice colours on the charcoal card, and as dots beside each group. */
export const SLICE_COLOURS: Record<AccountGroup['slice'], string> = {
  funds: '#8FD1AE',
  bank: '#7FB2E5',
  stocks: '#E8C46A',
  deposits: '#C3AEF2',
  rest: 'rgba(255,255,255,0.28)',
};

export const SLICE_LABELS: Record<AccountGroup['slice'], string> = {
  funds: 'Mutual funds',
  bank: 'Bank',
  stocks: 'Stocks',
  deposits: 'Deposits',
  rest: 'Other',
};
