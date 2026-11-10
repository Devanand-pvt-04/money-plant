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
 * Statements without that payee line (PNB ONE) start straight with the remarks,
 * like `UPI/DR/631469291074/THALAMBU/YESB/q831977751@ybl/S`.
 * Null when the row moves no money.
 */
export function parseStatementRow(bank: BankId | null, row: StatementRowInput): ParsedStatementRow | null {
  const debit = toPaise(row.debit);
  const credit = toPaise(row.credit);
  const amount = debit && debit > 0 ? debit : credit && credit > 0 ? credit : null;
  if (amount === null || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  // A first line like "UPI/DR/…" is already remarks, not a payee line.
  const hasTitle = row.lines.length > 1 && !/^[A-Z]{2,5}\//i.test(row.lines[0] ?? '');
  const [title = '', ...rest] = hasTitle ? row.lines : ['', ...row.lines];
  const remarks = rest.join('');
  const parts = remarks.split('/').map((part) => part.trim());
  const kind = (parts[0] ?? '').toUpperCase();
  const channel = CHANNELS[kind] ?? (kind === 'CMS' && parts[1]?.toUpperCase() === 'UPI' ? 'upi' : 'other');
  // UPI/<payee>/<vpa>/..., UPI/DR/<ref>/<payee>/<bank>/<vpa>/..., CMS/UPI/<payee>/..., ACH/<payee>/<ref>, MMT/IMPS/<ref>/<note>/<payee>/...
  const signed = kind === 'UPI' && /^(DR|CR)$/i.test(parts[1] ?? '');
  const payee = signed ? parts[3] : kind === 'UPI' ? parts[1] : kind === 'CMS' ? parts[2] : kind === 'ACH' ? parts[1] : undefined;
  const vpa = parts.find((part) => /^[\w.\-]+@[\w.\-]+$/.test(part) && !/^X/i.test(part)) ?? null;
  const reference = parts.find((part) => /^\d{12}$/.test(part)) ?? parts.find((part) => /^[A-Z0-9]{10,22}$/.test(part) && /\d/.test(part) && part !== 'BANK') ?? null;
  // The first line is the payee cut to 10 letters, or a label like "Credit trxn"; the remarks have it in full.
  const counterparty = cleanCounterparty(payee || title || remarks);
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
