import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import {
  addDays,
  addMonths,
  dateOf,
  fundChart,
  monthOf,
  paise,
  scaleDecimal,
  startOfDate,
  type CasTransaction,
  type DateKey,
  type FundChartPoint,
  type MonthKey,
  type Paise,
} from '@money-plant/core';
import { fundTransactions, navHistory, postings, transactions, type LocalHolding } from '@money-plant/db-schema';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { fundValues, latestNavs, listHoldings } from './funds';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';

const HISTORY_FETCHED_KEY = 'funds.nav_history.fetched';
const HISTORY_EVERY_MS = 6 * 60 * 60_000;
/** The chart covers 12 months: 11 past month ends and today. */
const PAST_MONTHS = 11;

/** The key a holding's past NAVs are kept under: its AMFI code, or its ISIN. */
const schemeKey = (h: LocalHolding) => h.amfiCode ?? h.isin;

function pastMonths(): MonthKey[] {
  const current = monthOf(new Date());
  return Array.from({ length: PAST_MONTHS }, (_, i) => addMonths(current, i - PAST_MONTHS));
}

async function storedTransactions(accountId: string): Promise<(CasTransaction & { date: DateKey })[]> {
  const db = await getDb();
  return db
    .select()
    .from(fundTransactions)
    .where(eq(fundTransactions.accountId, accountId))
    .orderBy(asc(fundTransactions.date))
    .all()
    .map((row) => ({ date: row.date as DateKey, type: row.type, amount: row.amount, units: row.units, nav: row.nav }));
}

/** Money paid into (positive) or taken out of a fund account after its statement, from the ledger. */
async function flowsAfter(holding: LocalHolding): Promise<{ on: DateKey; amount: Paise }[]> {
  const db = await getDb();
  return db
    .select({ occurredAt: transactions.occurredAt, amount: postings.amountPaise })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(eq(postings.accountId, holding.accountId), isNull(transactions.deletedAt), gt(transactions.occurredAt, startOfDate(addDays(holding.asOf, 1)).toISOString())))
    .all()
    .map((row) => ({ on: dateOf(row.occurredAt), amount: paise(row.amount) }));
}

export interface FundHistoryRow {
  date: DateKey;
  label: string;
  amount: Paise | null;
  unitsE4: number | null;
  navE4: number | null;
  /** Paid after the statement: units are estimated until the next CAS. */
  estimated: boolean;
}

export interface FundPage {
  chart: FundChartPoint[];
  /** False until a CAS is imported again after this update: the chart then covers only since the statement. */
  hasStatementHistory: boolean;
  history: FundHistoryRow[];
}

const LABELS: Record<string, string> = {
  PURCHASE: 'Purchase',
  PURCHASE_SIP: 'SIP',
  REDEMPTION: 'Redemption',
  SWITCH_IN: 'Switch in',
  SWITCH_IN_MERGER: 'Switch in',
  SWITCH_OUT: 'Switch out',
  SWITCH_OUT_MERGER: 'Switch out',
  DIVIDEND_REINVEST: 'Dividend reinvested',
  REVERSAL: 'Reversal',
};

/**
 * NW-3 (decision 0015): one fund's 12-month chart of value against money put
 * in, and its purchases and redemptions, latest first.
 */
export async function fundPage(accountId: string, balance: Paise): Promise<FundPage | null> {
  const holding = (await listHoldings()).find((h) => h.accountId === accountId);
  if (!holding) return null;
  const db = await getDb();
  const key = schemeKey(holding);
  const [stored, flows, latest, values] = await Promise.all([
    storedTransactions(accountId),
    flowsAfter(holding),
    latestNavs(),
    fundValues(new Map([[accountId, balance]])),
  ]);
  const saved = key ? new Map(db.select().from(navHistory).where(eq(navHistory.amfiCode, key)).all().map((row) => [row.month, row.navE4])) : new Map<string, number>();
  const statementNav = holding.navE4 !== null && holding.navDate ? { navE4: holding.navE4, date: holding.navDate } : null;
  const fresh = (key && latest.get(key)) || null;
  const latestNav = fresh && (!holding.navDate || fresh.date >= holding.navDate) ? fresh : statementNav;
  const months = pastMonths().map((month) => ({ month, navE4: saved.get(month) ?? null }));
  const chart = fundChart({ transactions: stored, unitsE4: holding.unitsE4, cost: paise(holding.costPaise), asOf: holding.asOf, paidSince: flows, statementNav, latestNav, months });
  // Without the statement's transactions, months before it can't be worked out.
  const shown = stored.length > 0 ? chart : chart.filter((p) => p.month >= holding.asOf.slice(0, 7));
  const value = values.get(accountId);
  const paidIn = flows.filter((f) => f.on > holding.asOf && f.amount > 0).reduce((sum, f) => sum + f.amount, 0);
  if (value) shown.push({ month: monthOf(new Date()), value: value.value, invested: paise(holding.costPaise + paidIn) });

  const history: FundHistoryRow[] = [];
  for (const t of stored) {
    const unitsE4 = scaleDecimal(t.units, 4);
    if (!unitsE4) continue;
    const amount = scaleDecimal(t.amount, 2);
    history.push({
      date: t.date,
      label: LABELS[t.type ?? ''] ?? (t.type ?? '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      amount: amount === null ? null : paise(Math.abs(amount)),
      unitsE4,
      navE4: scaleDecimal(t.nav, 4),
      estimated: false,
    });
  }
  for (const flow of flows) {
    if (flow.on <= holding.asOf) continue;
    history.push({ date: flow.on, label: flow.amount > 0 ? 'Paid in' : 'Taken out', amount: paise(Math.abs(flow.amount)), unitsE4: null, navE4: null, estimated: true });
  }
  history.sort((a, b) => b.date.localeCompare(a.date));
  return { chart: shown, hasStatementHistory: stored.length > 0, history };
}

/**
 * Asks the nav-history function for the month-end NAVs the phone doesn't have
 * yet, for every fund held, at most every 6 hours. Months before a fund was
 * first bought aren't asked for. Returns true when new NAVs arrived.
 */
export async function fetchNavHistory(): Promise<boolean> {
  const fetched = await kvGet(HISTORY_FETCHED_KEY);
  if (fetched && Date.now() - Date.parse(fetched) < HISTORY_EVERY_MS) return false;
  const list = (await listHoldings()).filter((h) => schemeKey(h) !== null && h.unitsE4 > 0);
  if (list.length === 0) return false;
  const db = await getDb();
  const keys = list.map((h) => schemeKey(h)!);
  const have = new Set(db.select().from(navHistory).where(inArray(navHistory.amfiCode, keys)).all().map((row) => `${row.amfiCode}|${row.month}`));
  const firstBought = new Map(
    db
      .select({ accountId: fundTransactions.accountId, date: fundTransactions.date })
      .from(fundTransactions)
      .where(inArray(fundTransactions.accountId, list.map((h) => h.accountId)))
      .all()
      .reduce((map, row) => map.set(row.accountId, map.has(row.accountId) && map.get(row.accountId)! < row.date ? map.get(row.accountId)! : row.date), new Map<string, string>()),
  );
  const months = new Set<string>();
  for (const h of list) {
    // Without the statement's transactions, only months from the statement on can be drawn.
    const from = (firstBought.get(h.accountId) ?? h.asOf).slice(0, 7);
    for (const month of pastMonths()) if (month >= from && !have.has(`${schemeKey(h)}|${month}`)) months.add(month);
  }
  if (months.size === 0) {
    await kvSet(HISTORY_FETCHED_KEY, new Date().toISOString());
    return false;
  }
  const codes = [...new Set(list.map((h) => h.amfiCode).filter((c): c is string => !!c))];
  const isins = [...new Set(list.filter((h) => !h.amfiCode && h.isin).map((h) => h.isin!))];
  const { data, error } = await supabase.functions.invoke<{ navs: { code: string; isins: string[]; nav: string; date: string; month: string }[] }>('nav-history', {
    body: { codes, isins, months: [...months].sort() },
  });
  if (error || !data) return false;
  let added = 0;
  db.transaction((t) => {
    for (const row of data.navs) {
      const navE4 = scaleDecimal(row.nav, 4);
      if (navE4 === null || navE4 <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^\d{4}-\d{2}$/.test(row.month)) continue;
      for (const h of list) {
        if (h.amfiCode !== row.code && !(h.isin && row.isins.includes(h.isin))) continue;
        t.insert(navHistory)
          .values({ amfiCode: schemeKey(h)!, month: row.month, navE4, date: row.date })
          .onConflictDoUpdate({ target: [navHistory.amfiCode, navHistory.month], set: { navE4, date: row.date } })
          .run();
        added++;
      }
    }
  });
  await kvSet(HISTORY_FETCHED_KEY, new Date().toISOString());
  if (added > 0) notifyLedgerChange();
  return added > 0;
}
