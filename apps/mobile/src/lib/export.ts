import { Directory } from 'expo-file-system';
import { asc, isNull } from 'drizzle-orm';
import { ACCOUNT_TYPE_LABELS, dateKey, paise, rupeesDecimal, toCsv, type AccountType } from '@money-plant/core';
import { accountTypes, accounts, budgets, postings, recurring, transactions } from '@money-plant/db-schema';
import { getDb } from './db';
import { listIous } from './ious';

export interface ExportResult {
  folder: string;
  files: string[];
}

const MONEY: ReadonlySet<AccountType> = new Set<AccountType>(['bank', 'cash', 'wallet', 'credit_card', 'loan', 'fd', 'rd', 'mutual_fund', 'stock', 'custom']);
const pad = (n: number) => String(n).padStart(2, '0');
const localTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * ACC-4: the user's data as CSV files, written to a folder they pick (for
 * example Downloads). Entries come one row each, readable in a spreadsheet;
 * postings.csv has every leg of every entry, so the ledger can be rebuilt
 * exactly. SMS text is never written: only the fields the app read from it.
 * Returns null when the user closes the folder picker.
 */
export async function exportData(): Promise<ExportResult | null> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return null;
  }
  const files = await buildFiles();
  const stamp = dateKey(new Date());
  const written: string[] = [];
  for (const [name, csv] of files) {
    const file = folder.createFile(`money-plant-${name}-${stamp}.csv`, 'text/csv');
    await file.write(csv);
    written.push(file.name);
  }
  return { folder: folder.name, files: written };
}

async function buildFiles(): Promise<[string, string][]> {
  const db = await getDb();
  const accountRows = db.select().from(accounts).where(isNull(accounts.deletedAt)).orderBy(asc(accounts.type), asc(accounts.name)).all();
  const typeRows = db.select().from(accountTypes).where(isNull(accountTypes.deletedAt)).all();
  const txRows = db.select().from(transactions).where(isNull(transactions.deletedAt)).orderBy(asc(transactions.occurredAt)).all();
  const postingRows = db.select().from(postings).all();
  const budgetRows = db.select().from(budgets).where(isNull(budgets.deletedAt)).all();
  const recurringRows = db.select().from(recurring).where(isNull(recurring.deletedAt)).all();
  const iouViews = await listIous();

  const byId = new Map(accountRows.map((a) => [a.id, a]));
  const typeName = new Map(typeRows.map((t) => [t.id, t.name]));
  const name = (id: string | null) => (id ? (byId.get(id)?.name ?? '') : '');
  const categoryPath = (id: string | null) => {
    const account = id ? byId.get(id) : undefined;
    if (!account) return '';
    const parent = account.parentId ? byId.get(account.parentId) : undefined;
    return parent ? `${parent.name} > ${account.name}` : account.name;
  };
  const legs = new Map<string, typeof postingRows>();
  for (const p of postingRows) legs.set(p.transactionId, [...(legs.get(p.transactionId) ?? []), p]);

  const entries = txRows.map((t) => {
    const own = legs.get(t.id) ?? [];
    const out = own.filter((p) => p.amountPaise < 0);
    const into = own.filter((p) => p.amountPaise > 0);
    const amount = into.reduce((s, p) => s + p.amountPaise, 0);
    const category = own.find((p) => byId.get(p.accountId)?.type === 'category');
    const person = own.find((p) => byId.get(p.accountId)?.type === 'person');
    return [
      dateKey(new Date(t.occurredAt)),
      localTime(t.occurredAt),
      t.kind,
      t.counterparty,
      rupeesDecimal(paise(amount)),
      out.map((p) => name(p.accountId)).join(' + '),
      into.map((p) => name(p.accountId)).join(' + '),
      category ? categoryPath(category.accountId) : '',
      person ? name(person.accountId) : '',
      t.note,
      t.status,
      t.id,
    ];
  });

  const postingsCsv = txRows.flatMap((t) =>
    (legs.get(t.id) ?? []).map((p) => [t.id, t.occurredAt, p.accountId, name(p.accountId), rupeesDecimal(paise(p.amountPaise))]),
  );

  const accountsCsv = accountRows.map((a) => [
    a.type === 'category' ? 'Category' : a.type === 'custom' ? (typeName.get(a.accountTypeId ?? '') ?? 'Custom') : ACCOUNT_TYPE_LABELS[a.type],
    a.type === 'category' ? categoryPath(a.id) : a.name,
    a.institution,
    a.last4,
    MONEY.has(a.type) ? rupeesDecimal(paise(a.openingBalancePaise)) : '',
    a.vpa,
    a.email,
    a.id,
  ]);

  const budgetsCsv = budgetRows
    .filter((b) => b.limitPaise !== null)
    .map((b) => [b.month ?? 'Every month', b.categoryAccountId ? categoryPath(b.categoryAccountId) : 'Overall', rupeesDecimal(paise(b.limitPaise!))]);

  const recurringCsv = recurringRows.map((r) => [
    r.name,
    rupeesDecimal(paise(r.amountPaise)),
    r.cadence,
    r.nextDue,
    name(r.accountId),
    categoryPath(r.categoryAccountId),
    r.status,
    r.vpa ?? r.merchant,
  ]);

  const iousCsv = iouViews.map((v) => [
    v.occurredOn,
    v.otherName,
    v.direction === 'lent' ? 'They owe me' : 'I owe them',
    rupeesDecimal(v.amount),
    rupeesDecimal(v.outstanding),
    v.dueDate,
    v.reason,
    v.state,
  ]);

  return [
    ['entries', toCsv(['Date', 'Time', 'Kind', 'Payee', 'Amount', 'From', 'To', 'Category', 'Person', 'Note', 'Status', 'Entry ID'], entries)],
    ['postings', toCsv(['Entry ID', 'When', 'Account ID', 'Account', 'Amount'], postingsCsv)],
    ['accounts', toCsv(['Type', 'Name', 'Bank', 'Last 4', 'Opening balance', 'UPI ID', 'Email', 'ID'], accountsCsv)],
    ['budgets', toCsv(['Month', 'Category', 'Limit'], budgetsCsv)],
    ['recurring', toCsv(['Name', 'Amount', 'Every', 'Next due', 'Paid from', 'Category', 'Status', 'Payee'], recurringCsv)],
    ['ious', toCsv(['Date', 'Person', 'Direction', 'Amount', 'Still owed', 'Due', 'Reason', 'State'], iousCsv)],
  ];
}
