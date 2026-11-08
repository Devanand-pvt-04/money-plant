import type { CurrencyCode, Paise } from '@money-plant/core';

export const BANKS = ['hdfc', 'icici', 'sbi', 'hsbc', 'slice'] as const;
export type BankId = (typeof BANKS)[number];

export const BANK_NAMES: Record<BankId, string> = {
  hdfc: 'HDFC Bank',
  icici: 'ICICI Bank',
  sbi: 'SBI',
  hsbc: 'HSBC',
  slice: 'slice',
};

export type Direction = 'debit' | 'credit';

/**
 * What the message is about. `card` means the message names a card but doesn't
 * say whether it is a debit or credit card.
 */
export type Instrument = 'account' | 'credit_card' | 'debit_card' | 'card';

export type Channel = 'upi' | 'card' | 'neft' | 'imps' | 'rtgs' | 'atm' | 'other';

/** The fields a bank SMS yields. These, never the message text, are what leave the parser. */
export interface ParsedTransaction {
  bank: BankId | null;
  direction: Direction;
  amount: Paise;
  instrument: Instrument;
  /** Last 3 or 4 digits of the account or card, as printed in the message. */
  accountLast: string | null;
  /** Merchant or person on the other side, as printed. */
  counterparty: string | null;
  vpa: string | null;
  /** UPI RRN, NEFT/IMPS/RTGS UTR or similar. Used to merge duplicates. */
  reference: string | null;
  /** Available balance after the transaction, for bank accounts. */
  balance: Paise | null;
  /** Available credit limit after the transaction, for credit cards. */
  availableLimit: Paise | null;
  channel: Channel;
  /** Id of the bank template that matched, or `generic`. */
  template: string;
  /** 0 to 1. Template matches score higher than generic ones. */
  confidence: number;
  /** A credit the message calls a refund or reversal (LED-5). Missing means no. */
  refund?: boolean;
  /**
   * The currency of `amount` when the message gives it in another currency
   * than the rupee, "USD 25.00 spent on card" (CAP-10, decision 0017).
   * Missing means rupees. Balance and limit stay in rupees.
   */
  currency?: CurrencyCode;
  /**
   * Set on the phone once a foreign amount is converted to rupees at that
   * day's rate: `amount` is then the estimate and this is what the message
   * said. A statement row replaces the estimate (CAP-10).
   */
  foreign?: { amount: number; currency: CurrencyCode };
}

export type SmsParseResult =
  | { status: 'parsed'; transaction: ParsedTransaction }
  /** Not a transaction: OTPs, offers, reminders, failed payments. */
  | { status: 'ignored'; reason: IgnoreReason }
  /** Looks like a transaction but the parser could not read it. Counted for CAP-8. */
  | { status: 'failed'; reason: FailReason };

export type IgnoreReason =
  | 'unknown_sender'
  | 'otp'
  | 'promotion'
  | 'reminder'
  | 'failed_payment'
  | 'request'
  | 'no_amount';

export type FailReason = 'no_direction' | 'unreadable_amount';

export interface SmsInput {
  /** Sender address, e.g. "VM-HDFCBK-S". */
  sender: string;
  body: string;
}
