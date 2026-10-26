import * as Crypto from 'expo-crypto';
import { addDays, paise, startOfDate, type Paise } from '@money-plant/core';
import { digitsMatch, ingestStatementRow, institutionBank, rebaseOpening, type IngestResult } from '@money-plant/matcher';
import { parseStatementRow, type BankId, type ParsedStatementRow, type StatementRowInput } from '@money-plant/parser';
import { pipelineCategoriser } from './categories';
import { notifyLedgerChange } from './events';
import { listAccountBalances, type AccountBalance } from './ledger';
import { SqliteLedgerStore } from './ledger-store';
import { PdfError, sendPdf, type PdfFile } from './pdf-service';

/** What the statement reader returns: rows only, never the holder's name, address or full account number. */
export interface StatementData {
  bank: BankId | null;
  account_last4: string | null;
  rows: StatementRowInput[];
  warnings: string[];
}

/** CAP-5: reads a bank statement PDF through the parse-statement edge function. */
export async function readStatement(file: PdfFile, password: string): Promise<StatementData> {
  const data = await sendPdf<StatementData>('parse-statement', file, password);
  if (!Array.isArray(data.rows)) throw new PdfError('not_a_statement');
  return data;
}

export interface StatementPreview {
  rows: ParsedStatementRow[];
  from: string | null;
  to: string | null;
  debits: Paise;
  credits: Paise;
  /** The bank account the statement is most likely for, by bank and last digits. */
  suggested: AccountBalance | null;
}

export async function previewStatement(data: StatementData): Promise<StatementPreview> {
  const rows = data.rows.map((row) => parseStatementRow(data.bank, row)).filter((row): row is ParsedStatementRow => row !== null);
  const dates = rows.map((r) => r.date).sort();
  const banks = (await listAccountBalances()).filter((b) => b.account.type === 'bank');
  const ofBank = banks.filter((b) => data.bank === null || institutionBank(b.account.institution) === data.bank);
  const last4 = data.account_last4;
  const suggested =
    (last4 ? ofBank.find((b) => b.account.last4 !== null && digitsMatch(b.account.last4, last4)) : undefined) ??
    (ofBank.length === 1 ? ofBank[0] : undefined) ??
    null;
  return {
    rows,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    debits: paise(rows.filter((r) => r.direction === 'debit').reduce((s, r) => s + r.amount, 0)),
    credits: paise(rows.filter((r) => r.direction === 'credit').reduce((s, r) => s + r.amount, 0)),
    suggested,
  };
}

export interface StatementImportResult {
  /** Rows that matched an entry the SMS already made. */
  matched: number;
  /** Rows that were the other side of a transfer. */
  transfers: number;
  /** Payments the SMS missed, now added. */
  added: number;
  /** Rows already imported from this statement before. */
  skipped: number;
}

/**
 * CAP-5: imports a statement's rows into one bank account. Rows the SMS
 * already recorded are attached to those entries; the rest become entries,
 * categorised like SMS ones. The closing balance becomes a bank anchor, so
 * reconciliation (LED-5) can check the ledger against it. Importing the same
 * statement twice changes nothing.
 */
export async function importStatement(rows: readonly ParsedStatementRow[], accountId: string): Promise<StatementImportResult> {
  const store = await SqliteLedgerStore.open();
  const ctx = { store, newId: () => Crypto.randomUUID(), categorise: await pipelineCategoriser() };
  const claimed = new Set<string>();
  const seen = new Map<string, number>();
  const result: StatementImportResult = { matched: 0, transfers: 0, added: 0, skipped: 0 };
  let closing: { sourceId: string; balance: Paise; date: string } | null = null;

  for (const row of rows) {
    // Two identical rows on one day are two payments; the count keeps their fingerprints apart.
    const key = [accountId, row.date, row.direction, row.amount, row.reference ?? row.counterparty ?? ''].join('|');
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `statement|${key}|${n}`);
    const day = startOfDate(row.date);
    const noon = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12);
    const sourceId = Crypto.randomUUID();
    const outcome: IngestResult = await ingestStatementRow(
      ctx,
      { parsed: row, accountId, occurredAt: noon.toISOString(), dayStart: day.toISOString(), fingerprint, sourceId },
      claimed,
    );
    if (outcome.outcome === 'duplicate_source') result.skipped++;
    else if (outcome.outcome === 'attached') result.matched++;
    else if (outcome.outcome === 'transfer') result.transfers++;
    else result.added++;
    // Only the statement's last row: its balance is the day's closing balance. On a re-import it already has its anchor.
    closing = outcome.outcome !== 'duplicate_source' && row.balance !== null ? { sourceId, balance: row.balance, date: row.date } : null;
  }

  if (closing) {
    // The balance at the end of the statement's last day, after every payment that day.
    const observedAt = new Date(startOfDate(addDays(closing.date, 1)).getTime() - 1000).toISOString();
    await store.addAnchor({ id: Crypto.randomUUID(), accountId, balance: closing.balance, observedAt, sourceId: closing.sourceId });
    const ref = await store.getBalanceRef(accountId);
    // Like SMS anchors: the earliest one the bank reported is the reference.
    if (!ref || (ref.kind === 'anchor' && observedAt < ref.at)) await store.setBalanceRef(accountId, { kind: 'anchor', balance: closing.balance, at: observedAt });
  }
  await rebaseOpening(store, accountId);
  notifyLedgerChange();
  return result;
}
