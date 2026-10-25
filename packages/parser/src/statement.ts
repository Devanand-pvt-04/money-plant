import { paise, type Paise } from '@money-plant/core';
import { cleanCounterparty } from './extract';
import type { BankId, Channel, Direction } from './types';

/** A row as the statement reader returns it: the remarks lines and decimal-string amounts. */
export interface StatementRowInput {
  date: string;
  lines: string[];
  debit: string | null;
  credit: string | null;
  balance: string | null;
}

/** The fields a statement row yields (CAP-5). The remarks themselves stay on the phone. */
export interface ParsedStatementRow {
  bank: BankId | null;
  /** "2026-10-01". */
  date: string;
  direction: Direction;
  amount: Paise;
  counterparty: string | null;
  /** Statements mask UPI IDs (XXab12@okicici), so this is only set when one is printed in full. */
  vpa: string | null;
  /** UPI RRN or IMPS/NEFT reference; the same number as on the SMS, so the two merge. */
  reference: string | null;
  balance: Paise | null;
  channel: Channel;
}

const toPaise = (text: string | null): Paise | null => {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec((text ?? '').replace(/,/g, ''));
  if (!match) return null;
  const value = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return paise(match[1] ? -value : value);
};

const CHANNELS: Record<string, Channel> = { UPI: 'upi', IMPS: 'imps', MMT: 'imps', NEFT: 'neft', RTGS: 'rtgs', ATM: 'atm', NFS: 'atm', VPS: 'card', IPS: 'card', POS: 'card' };

/**
 * Reads one statement row (CAP-5). ICICI prints the payee on the first line
 * and remarks like `UPI/ANNA IDLI/XX961w@pty/UPI/YES BANK/627460149987/ICI…`
 * after it, wrapped mid-word, so the wrapped lines are joined without spaces.
 * Null when the row moves no money.
 */
export function parseStatementRow(bank: BankId | null, row: StatementRowInput): ParsedStatementRow | null {
  const debit = toPaise(row.debit);
  const credit = toPaise(row.credit);
  const amount = debit && debit > 0 ? debit : credit && credit > 0 ? credit : null;
  if (amount === null || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  const [title = '', ...rest] = row.lines;
  // A one-line row is all remarks.
  const remarks = rest.length > 0 ? rest.join('') : title;
  const parts = remarks.split('/').map((part) => part.trim());
  const kind = (parts[0] ?? '').toUpperCase();
  const channel = CHANNELS[kind] ?? (kind === 'CMS' && parts[1]?.toUpperCase() === 'UPI' ? 'upi' : 'other');
  // UPI/<payee>/<vpa>/..., CMS/UPI/<payee>/..., MMT/IMPS/<ref>/<note>/<payee>/...
  const payee = kind === 'UPI' ? parts[1] : kind === 'CMS' ? parts[2] : undefined;
  const vpa = parts.find((part) => /^[\w.\-]+@[\w.\-]+$/.test(part) && !/^X/i.test(part)) ?? null;
  const reference = parts.find((part) => /^\d{12}$/.test(part)) ?? parts.find((part) => /^[A-Z0-9]{10,22}$/.test(part) && /\d/.test(part) && part !== 'BANK') ?? null;
  // The first line is the payee cut to 10 letters, or a label like "Credit trxn"; the remarks have it in full.
  const counterparty = cleanCounterparty(payee || title);
  return {
    bank,
    date: row.date,
    direction: debit && debit > 0 ? 'debit' : 'credit',
    amount,
    counterparty,
    vpa: vpa ? vpa.toLowerCase() : null,
    reference,
    balance: toPaise(row.balance),
    channel,
  };
}
