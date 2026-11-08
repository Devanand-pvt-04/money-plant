import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { convertOn, DEFAULT_CURRENCY, paise, type CurrencyCode, type Paise } from '@money-plant/core';
import { fxRates, postings, transactions } from '@money-plant/db-schema';
import { getDb } from './db';
import { loadRates, requestRates } from './fx';
import { homeCurrency } from './home-currency';
import { kvGet, kvSet } from './kv';
import { netWorth, type AccountBalance } from './ledger';

const SNAPSHOT_PREFIX = 'networth.';
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export interface NetWorthPoint {
  /** "2026-10". */
  month: string;
  value: Paise;
}

/**
 * NW-4: net worth at the end of each of the last `months` months, this month
 * as it stands now. Each month's last value seen on this phone is kept, so
 * funds and deposits count at what they were worth then; months before that
 * are rebuilt from the ledger, with funds and deposits at what was paid in.
 * Months before the first entry are left out.
 */
/** A month's saved value, kept with its currency; values from before currencies are rupees. */
function readSnapshot(saved: string | null, home: CurrencyCode): Paise | null {
  if (saved === null) return null;
  const [amount, currency = DEFAULT_CURRENCY] = saved.split('|');
  return currency === home && amount !== undefined && /^-?\d+$/.test(amount) ? paise(Number(amount)) : null;
}

const dayKey = (date: Date) => `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;

export async function netWorthHistory(balances: readonly AccountBalance[], months = 6): Promise<NetWorthPoint[]> {
  const now = new Date();
  const current = monthKey(now);
  const home = homeCurrency();
  const value = netWorth(balances);
  await kvSet(`${SNAPSHOT_PREFIX}${current}`, `${value}|${home}`);

  const db = await getDb();
  const counted = balances.filter((b) => b.inNetWorth);
  const ids = counted.map((b) => b.account.id);
  if (ids.length === 0) return [{ month: current, value }];
  const first = db
    .select({ at: sql<string | null>`min(${transactions.occurredAt})` })
    .from(transactions)
    .where(isNull(transactions.deletedAt))
    .get()?.at;
  // NW-7: rebuilt months add up each currency, converted at that month's last rate.
  const openingBy = new Map<CurrencyCode, number>();
  for (const b of counted) openingBy.set(b.currency, (openingBy.get(b.currency) ?? 0) + b.account.openingBalancePaise);
  const currencies = [...new Set([...openingBy.keys(), home])];
  const foreign = currencies.some((c) => c !== DEFAULT_CURRENCY);
  let rates = foreign ? await loadRates(currencies) : [];
  if (foreign) {
    const ends: string[] = [];
    for (let back = months - 1; back >= 1; back--) ends.push(dayKey(new Date(now.getFullYear(), now.getMonth() - back + 1, 0)));
    const known = new Set(db.select({ date: fxRates.date }).from(fxRates).all().map((r) => r.date));
    const missing = ends.filter((d) => !known.has(d));
    if (missing.length > 0 && (await requestRates(currencies, missing).catch(() => false))) rates = await loadRates(currencies);
  }

  const points: NetWorthPoint[] = [];
  for (let back = months - 1; back >= 1; back--) {
    const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - back + 1, 1);
    if (!first || first >= end.toISOString()) continue;
    const month = monthKey(start);
    const saved = readSnapshot(await kvGet(`${SNAPSHOT_PREFIX}${month}`), home);
    if (saved !== null) {
      points.push({ month, value: saved });
      continue;
    }
    const posted = db
      .select({ currency: postings.currency, total: sql<number>`coalesce(sum(${postings.amountPaise}), 0)` })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(and(inArray(postings.accountId, ids), isNull(transactions.deletedAt), lt(transactions.occurredAt, end.toISOString())))
      .groupBy(postings.currency)
      .all();
    const totals = new Map(openingBy);
    for (const row of posted) totals.set(row.currency, (totals.get(row.currency) ?? 0) + Number(row.total));
    const monthEnd = dayKey(new Date(end.getTime() - 86_400_000));
    let sum = 0;
    let known = true;
    for (const [currency, total] of totals) {
      const converted = convertOn(rates, total, currency, home, monthEnd);
      if (converted === null) known = false;
      else sum += converted;
    }
    // A month whose rates never loaded is left out rather than shown wrong.
    if (known) points.push({ month, value: paise(sum) });
  }
  points.push({ month: current, value });
  return points;
}
