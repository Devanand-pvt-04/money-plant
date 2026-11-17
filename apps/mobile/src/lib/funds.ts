import * as Crypto from 'expo-crypto';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  addDays,
  casDate,
  casHoldings as casHoldingsOf,
  dateKey,
  dateOf,
  pairFlows,
  paise,
  scaleDecimal,
  startOfDate,
  holdingValue,
  shortSchemeName,
  sipFundFor,
  firstWeekday,
  learnNavLag,
  navFrom,
  DEFAULT_NAV_LAG,
  FLOW_DAYS_AFTER,
  FLOW_DAYS_BEFORE,
  type CasStatement,
  type FundValue,
  type CasTransaction,
  type DematStatement,
  type DateKey,
  type FlowCandidate,
  type NavLag,
  type NavPoint,
  type Paise,
} from '@money-plant/core';
import { accounts, fundTransactions, holdings, navAfter, navs, postings, transactions, type LocalHolding } from '@money-plant/db-schema';
import type { LedgerPosting, LedgerTransaction } from '@money-plant/matcher';
import { rebaseOpening } from '@money-plant/matcher';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { derivedId } from './ids';
import { kvGet, kvSet } from './kv';
import { loadTransactions, SqliteLedgerStore, writeTransaction } from './ledger-store';
import { PdfError, sendPdf, type PdfFile } from './pdf-service';
import { supabase } from './supabase';

const now = () => new Date().toISOString();
const today = () => dateKey(new Date());
const NAV_FETCHED_KEY = 'funds.nav.fetched';
const NAV_EVERY_MS = 6 * 60 * 60_000;
const ORDERS_FETCHED_KEY = 'funds.nav_after.fetched';
const ORDERS_EVERY_MS = 3 * 60 * 60_000;
/** Decision 0031: the NAV day each fund prices a SIP debit at, learned from its CAS. */
const lagKey = (accountId: string) => `funds.nav_lag.${accountId}`;
/** The key a holding's NAVs are kept under: its AMFI code, or its ISIN. */
const schemeKey = (h: { amfiCode: string | null; isin: string | null }) => h.amfiCode ?? h.isin;

/** NW-3, NW-5: reads a CAS PDF through the parse-cas edge function: funds from CAMS or KFinTech, or a demat statement from NSDL or CDSL. */
export async function readCas(file: PdfFile, password: string): Promise<CasStatement | DematStatement> {
  const data = await sendPdf<CasStatement | DematStatement>('parse-cas', file, password);
  if ('kind' in data && data.kind === 'demat') {
    if (!Array.isArray(data.accounts)) throw new PdfError('not_a_cas');
    return data;
  }
  if (!Array.isArray((data as CasStatement).folios)) throw new PdfError('not_a_cas');
  return data as CasStatement;
}

export type { CasHolding, FundValue } from '@money-plant/core';
export { shortSchemeName };

/** The schemes still held, as of the statement's end (casHoldings in core). */
export const casHoldings = (statement: CasStatement) => casHoldingsOf(statement, today());

/** Accounts that hold the user's money and can pay into a fund, so not funds, categories or people. */
export function payingAccounts(db: Awaited<ReturnType<typeof getDb>>): Set<string> {
  return new Set(
    db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
      .all()
      .filter((a) => !['category', 'person', 'exchange', 'settled', 'mutual_fund', 'stock', 'nps', 'savings_scheme', 'fd', 'rd'].includes(a.type))
      .map((a) => a.id),
  );
}

/** Expense and income entries in a date range that are one bank leg and one category leg, with the bank leg. */
export function bankEntries(db: Awaited<ReturnType<typeof getDb>>, from: DateKey, to: DateKey) {
  const owned = payingAccounts(db);
  return loadTransactions(
    db,
    db
      .select()
      .from(transactions)
      .where(
        and(
          isNull(transactions.deletedAt),
          inArray(transactions.kind, ['expense', 'income']),
          gte(transactions.occurredAt, startOfDate(from).toISOString()),
          lt(transactions.occurredAt, startOfDate(addDays(to, 1)).toISOString()),
        ),
      )
      .all(),
  )
    .filter((tx) => !tx.userSetFields.includes('kind') && tx.postings.length === 2)
    .flatMap((tx) => {
      const legs = tx.postings.filter((p) => owned.has(p.accountId));
      return legs.length === 1 ? [{ tx, leg: legs[0]! }] : [];
    });
}

const candidateOf = ({ tx, leg }: { tx: LedgerTransaction; leg: LedgerPosting }): FlowCandidate => ({
  id: tx.id,
  on: dateOf(tx.occurredAt),
  amount: paise(Math.abs(leg.amount)),
  direction: leg.amount < 0 ? 'in' : 'out',
  counterparty: tx.counterparty,
});

/** Turns a bank entry into a transfer between the bank account and one or more funds. */
export function toTransfer(db: Awaited<ReturnType<typeof getDb>>, tx: LedgerTransaction, leg: LedgerPosting, parts: { accountId: string; amount: Paise }[]): void {
  // Money into a fund leaves the bank (negative leg), so the fund side is positive, and the other way round.
  const sign = leg.amount < 0 ? 1 : -1;
  writeTransaction(db, {
    ...tx,
    kind: 'transfer',
    status: 'confirmed',
    reviewReason: null,
    categoryReason: null,
    categoryRuleId: null,
    postings: [leg, ...parts.map((part) => ({ id: Crypto.randomUUID(), accountId: part.accountId, amount: paise(sign * part.amount) }))],
  });
}

export interface CasImportResult {
  funds: number;
  added: number;
  matched: number;
}

/**
 * NW-3: saves a CAS's holdings, one mutual fund account per scheme and folio
 * (ids both phones derive alike, so importing again updates them).
 * - Each fund's balance is its cost on the statement's end date, so later
 *   SIPs add to it.
 * - Purchases and redemptions in the statement are matched to bank debits
 *   and credits already in the ledger and become transfers, so investing
 *   stops counting as spending.
 */
export async function importCas(statement: CasStatement): Promise<CasImportResult> {
  const db = await getDb();
  const items = casHoldings(statement);
  const store = new SqliteLedgerStore(db);
  const accountOf = new Map<string, string>();
  let added = 0;

  for (const item of items) {
    const accountId = await derivedId(`fund-account:${item.key}`);
    const id = await derivedId(`fund:${item.key}`);
    accountOf.set(item.key, accountId);
    const existing = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!existing || existing.deletedAt) {
      const values = { type: 'mutual_fund' as const, name: shortSchemeName(item.scheme), institution: item.amc, deletedAt: null, dirty: 1 };
      db.insert(accounts)
        .values({ id: accountId, ...values, openingBalancePaise: 0, createdAt: now() })
        .onConflictDoUpdate({ target: accounts.id, set: { ...values, rev: sql`${accounts.rev} + 1` } })
        .run();
      added++;
    }
    const values = {
      accountId,
      scheme: item.scheme,
      isin: item.isin,
      amfiCode: item.amfiCode,
      folio: item.folio,
      amc: item.amc,
      unitsE4: item.unitsE4,
      costPaise: item.cost,
      navE4: item.navE4,
      navDate: item.navDate,
      asOf: item.asOf,
      sipPaise: item.sip?.amount ?? null,
      sipDay: item.sip?.day ?? null,
      deletedAt: null,
      dirty: 1,
    };
    db.insert(holdings)
      .values({ id, ...values, createdAt: now() })
      .onConflictDoUpdate({ target: holdings.id, set: { ...values, rev: sql`${holdings.rev} + 1` } })
      .run();
    // Decision 0015: the statement's transactions, for the fund's chart and history. A newer statement replaces them.
    const kept = item.transactions
      .map((t) => ({ ...t, on: casDate(t.date) }))
      .filter((t): t is CasTransaction & { on: DateKey; type: string } => t.on !== null && !!t.type);
    db.transaction((t) => {
      t.delete(fundTransactions).where(eq(fundTransactions.accountId, accountId)).run();
      for (const row of kept) {
        t.insert(fundTransactions)
          .values({ id: Crypto.randomUUID(), accountId, date: row.on, type: row.type.slice(0, 40), amount: row.amount, units: row.units, nav: row.nav })
          .run();
      }
    });
  }

  // A scheme in a folio this statement covers, but no longer listed with units, was sold in full.
  const folios = new Set(statement.folios.map((f) => f.folio).filter((f): f is string => !!f));
  const end = items.map((i) => i.asOf).sort().pop();
  for (const old of await listHoldings()) {
    if (!end || !old.folio || !folios.has(old.folio) || old.asOf >= end || [...accountOf.values()].includes(old.accountId)) continue;
    db.update(holdings).set({ unitsE4: 0, costPaise: 0, asOf: end, sipPaise: null, sipDay: null, dirty: 1, rev: sql`${holdings.rev} + 1` }).where(eq(holdings.id, old.id)).run();
    await store.setBalanceRef(old.accountId, { kind: 'user', balance: paise(0), at: startOfDate(addDays(end, 1)).toISOString() });
    await rebaseOpening(store, old.accountId);
  }

  // Purchases and redemptions on the statement, matched to entries already in the ledger.
  const flows = items.flatMap((item) => item.flows.map((flow) => ({ ...flow, key: item.key, amc: item.amc })));
  let matched = 0;
  if (flows.length > 0) {
    const dates = flows.map((f) => f.date).sort();
    const entries = bankEntries(db, addDays(dates[0]!, -FLOW_DAYS_BEFORE), addDays(dates[dates.length - 1]!, FLOW_DAYS_AFTER));
    const byId = new Map(entries.map((entry) => [entry.tx.id, entry]));
    for (const pair of pairFlows(flows, entries.map(candidateOf))) {
      const entry = byId.get(pair.candidateId)!;
      toTransfer(db, entry.tx, entry.leg, pair.parts.map((part) => ({ accountId: accountOf.get(part.key)!, amount: part.amount })));
      matched++;
    }
  }

  // Decision 0031: which day's NAV each fund gave its SIPs, from the purchases matched to payments into it.
  for (const item of items) {
    const accountId = accountOf.get(item.key)!;
    const purchases = item.flows.filter((f) => f.direction === 'in').map((f) => ({ date: f.date, amount: f.amount }));
    if (purchases.length === 0) continue;
    const dates = purchases.map((p) => p.date).sort();
    const payments = db
      .select({ occurredAt: transactions.occurredAt, amount: postings.amountPaise })
      .from(postings)
      .innerJoin(transactions, eq(transactions.id, postings.transactionId))
      .where(
        and(
          isNull(transactions.deletedAt),
          eq(postings.accountId, accountId),
          gte(transactions.occurredAt, startOfDate(addDays(dates[0]!, -FLOW_DAYS_BEFORE)).toISOString()),
          lt(transactions.occurredAt, startOfDate(addDays(dates[dates.length - 1]!, 1)).toISOString()),
        ),
      )
      .all()
      .filter((row) => row.amount > 0)
      .map((row) => ({ on: dateOf(row.occurredAt), amount: paise(row.amount) }));
    const lag = learnNavLag(purchases, payments);
    if (lag !== null) await kvSet(lagKey(accountId), String(lag));
  }

  // The balance on the statement's end date is the cost of the units held then.
  for (const item of items) {
    const accountId = accountOf.get(item.key)!;
    await store.setBalanceRef(accountId, { kind: 'user', balance: item.cost, at: startOfDate(addDays(item.asOf, 1)).toISOString() });
    await rebaseOpening(store, accountId);
  }

  await kvSet(NAV_FETCHED_KEY, '');
  await refreshFunds();
  notifyLedgerChange();
  return { funds: items.length, added, matched };
}

/** Mutual fund holdings whose account still exists: one per mutual_fund account (NW-3). */
export async function listHoldings(): Promise<LocalHolding[]> {
  const db = await getDb();
  return db
    .select({ holding: holdings })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(and(isNull(holdings.deletedAt), isNull(accounts.deletedAt), eq(accounts.type, 'mutual_fund')))
    .all()
    .map((row) => row.holding);
}

/** The freshest NAV for a holding: AMFI's if it's newer than the statement's. */
export async function latestNavs(): Promise<Map<string, { navE4: number; date: DateKey }>> {
  const db = await getDb();
  const out = new Map<string, { navE4: number; date: DateKey }>();
  for (const row of db.select().from(navs).all()) {
    out.set(row.amfiCode, { navE4: row.navE4, date: row.date });
    if (row.isin) out.set(row.isin, { navE4: row.navE4, date: row.date });
  }
  return out;
}

/** Money in and out of each fund account after a date, per account: [date, amount] pairs. */
async function flowsSince(list: readonly LocalHolding[]): Promise<Map<string, { on: DateKey; amount: Paise }[]>> {
  const out = new Map<string, { on: DateKey; amount: Paise }[]>();
  if (list.length === 0) return out;
  const db = await getDb();
  const from = list.map((h) => h.asOf).sort()[0]!;
  const rows = db
    .select({ accountId: postings.accountId, occurredAt: transactions.occurredAt, amount: postings.amountPaise })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .where(and(isNull(transactions.deletedAt), inArray(postings.accountId, list.map((h) => h.accountId)), gte(transactions.occurredAt, startOfDate(addDays(from, 1)).toISOString())))
    .all();
  for (const row of rows) {
    const list = out.get(row.accountId) ?? [];
    list.push({ on: dateOf(row.occurredAt), amount: paise(row.amount) });
    out.set(row.accountId, list);
  }
  return out;
}

/**
 * NW-1, NW-3: what each fund account is worth today, keyed by account id.
 * `balances` are the accounts' ledger balances. Money paid in after the
 * statement buys units at the NAV estimated for its day (navOn), so a SIP
 * grows with the fund; money taken out counts at what it was.
 */
export async function fundValues(balances: ReadonlyMap<string, Paise>): Promise<Map<string, FundValue>> {
  const latest = await latestNavs();
  const list = await listHoldings();
  const flows = await flowsSince(list);
  const published = await publishedNavs();
  const on = today();
  const out = new Map<string, FundValue>();
  for (const holding of list) {
    const key = schemeKey(holding);
    const orders = { lag: await navLag(holding.accountId), published: (key && published.get(key)) || new Map<string, NavPoint>(), today: on };
    out.set(holding.accountId, holdingValue(holding, latest, flows.get(holding.accountId) ?? [], balances.get(holding.accountId), orders));
  }
  return out;
}

/** Decision 0031: the day a fund prices SIP debits at, as learned from its CAS, or the next business day. */
export async function navLag(accountId: string): Promise<NavLag> {
  const saved = await kvGet(lagKey(accountId));
  return saved === '0' ? 0 : saved === '1' ? 1 : DEFAULT_NAV_LAG;
}

/** The NAVs SIP orders were allotted at, by scheme key, then by the day asked about. */
async function publishedNavs(): Promise<Map<string, Map<string, NavPoint>>> {
  const db = await getDb();
  const out = new Map<string, Map<string, NavPoint>>();
  for (const row of db.select().from(navAfter).all()) {
    const days = out.get(row.amfiCode) ?? new Map<string, NavPoint>();
    days.set(row.fromDate, { navE4: row.navE4, date: row.date as DateKey });
    out.set(row.amfiCode, days);
  }
  return out;
}

/**
 * Decision 0031: asks nav-history for the NAV each SIP order waits for, once
 * the day it expects has come, at most every 3 hours while any order waits.
 * AMFI publishes a day's NAVs late that evening, so an order usually completes
 * that night or the next morning. Returns true when an order got its NAV.
 */
export async function fetchOrderNavs(): Promise<boolean> {
  const list = (await listHoldings()).filter((h) => schemeKey(h) !== null);
  if (list.length === 0) return false;
  const db = await getDb();
  const have = new Set(db.select().from(navAfter).all().map((row) => `${row.amfiCode}|${row.fromDate}`));
  const flows = await flowsSince(list);
  const on = today();
  const wanted: { holding: LocalHolding; from: DateKey }[] = [];
  for (const holding of list) {
    const lag = await navLag(holding.accountId);
    for (const flow of flows.get(holding.accountId) ?? []) {
      if (flow.on <= holding.asOf || flow.amount <= 0) continue;
      const from = navFrom(flow.on, lag);
      if (firstWeekday(from) > on || have.has(`${schemeKey(holding)}|${from}`)) continue;
      wanted.push({ holding, from });
    }
  }
  if (wanted.length === 0) return false;
  const fetched = await kvGet(ORDERS_FETCHED_KEY);
  if (fetched && Date.now() - Date.parse(fetched) < ORDERS_EVERY_MS) return false;

  const days = [...new Set(wanted.map((w) => w.from))].sort().slice(-12);
  const holdingsAsked = [...new Set(wanted.filter((w) => days.includes(w.from)).map((w) => w.holding))];
  const codes = [...new Set(holdingsAsked.map((h) => h.amfiCode).filter((c): c is string => !!c))];
  const isins = [...new Set(holdingsAsked.filter((h) => !h.amfiCode && h.isin).map((h) => h.isin!))];
  const { data, error } = await supabase.functions.invoke<{ navs: { code: string; isins: string[]; nav: string; date: string; after?: string }[] }>('nav-history', {
    body: { codes, isins, after: days },
  });
  if (error || !data) return false;
  await kvSet(ORDERS_FETCHED_KEY, new Date().toISOString());
  let added = 0;
  db.transaction((t) => {
    for (const row of data.navs) {
      const navE4 = scaleDecimal(row.nav, 4);
      if (navE4 === null || navE4 <= 0 || !row.after || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !/^\d{4}-\d{2}-\d{2}$/.test(row.after) || row.date < row.after) continue;
      for (const h of holdingsAsked) {
        if (h.amfiCode !== row.code && !(h.isin && row.isins.includes(h.isin))) continue;
        t.insert(navAfter)
          .values({ amfiCode: schemeKey(h)!, fromDate: row.after, navE4, date: row.date })
          .onConflictDoUpdate({ target: [navAfter.amfiCode, navAfter.fromDate], set: { navE4, date: row.date } })
          .run();
        added++;
      }
    }
  });
  return added > 0;
}

/**
 * Fetches the latest NAVs for the funds held, at most every 6 hours. AMFI publishes
 * each day's NAVs late in the evening, so a fetch that same night or the next
 * morning picks them up instead of waiting for the next calendar day.
 */
async function fetchNavs(list: LocalHolding[]): Promise<void> {
  const fetched = await kvGet(NAV_FETCHED_KEY);
  if ((fetched && Date.now() - Date.parse(fetched) < NAV_EVERY_MS) || list.length === 0) return;
  const codes = [...new Set(list.map((h) => h.amfiCode).filter((c): c is string => !!c))];
  const isins = [...new Set(list.map((h) => h.isin).filter((c): c is string => !!c))];
  if (await requestNavs(codes, isins)) await kvSet(NAV_FETCHED_KEY, new Date().toISOString());
}

/** Asks the nav-prices function for these schemes and keeps their NAVs on the phone. False if it couldn't. */
export async function requestNavs(codes: string[], isins: string[]): Promise<boolean> {
  if (codes.length === 0 && isins.length === 0) return true;
  const { data, error } = await supabase.functions.invoke<{ navs: { code: string; isins: string[]; nav: string; date: string }[] }>('nav-prices', {
    body: { codes, isins },
  });
  if (error || !data) return false;
  const db = await getDb();
  db.transaction((t) => {
    for (const row of data.navs) {
      const navE4 = scaleDecimal(row.nav, 4);
      if (navE4 === null || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
      const isin = row.isins.find((i) => isins.includes(i)) ?? row.isins[0] ?? null;
      t.insert(navs)
        .values({ amfiCode: row.code, isin, navE4, date: row.date })
        .onConflictDoUpdate({ target: navs.amfiCode, set: { isin, navE4, date: row.date } })
        .run();
    }
  });
  return true;
}

/**
 * NW-3: keeps funds in step after an import.
 * - SIP debits after the statement, to a fund payee and of a fund's SIP
 *   amount, become transfers into that fund: one per fund a month, the fund
 *   whose SIP day is nearest when two share an amount.
 * - Today's NAVs are fetched once a day.
 * - SIP orders get the NAV of their day once AMFI publishes it (decision 0031).
 * Returns the number of entries changed.
 */
export async function refreshFunds(): Promise<number> {
  const db = await getDb();
  const list = (await listHoldings()).filter((h) => h.sipPaise !== null);
  let changed = 0;

  if (list.length > 0) {
    const from = list.map((h) => addDays(h.asOf, 1)).sort()[0]!;
    const entries = bankEntries(db, from, today()).filter((entry) => entry.leg.amount < 0);
    // Months each fund already received money in, from transfers already made.
    const funded = new Set(
      db
        .select({ accountId: postings.accountId, occurredAt: transactions.occurredAt })
        .from(postings)
        .innerJoin(transactions, eq(transactions.id, postings.transactionId))
        .where(and(isNull(transactions.deletedAt), eq(transactions.kind, 'transfer'), inArray(postings.accountId, list.map((h) => h.accountId)), gte(transactions.occurredAt, startOfDate(from).toISOString())))
        .all()
        .map((row) => `${row.accountId}|${dateOf(row.occurredAt).slice(0, 7)}`),
    );
    for (const { tx, leg } of entries.sort((a, b) => a.tx.occurredAt.localeCompare(b.tx.occurredAt))) {
      const on = dateOf(tx.occurredAt);
      const amount = -leg.amount;
      const fund = sipFundFor(list, { on, amount: paise(amount), payee: tx.counterparty }, funded);
      if (!fund) continue;
      toTransfer(db, tx, leg, [{ accountId: fund.accountId, amount: paise(amount) }]);
      funded.add(`${fund.accountId}|${on.slice(0, 7)}`);
      changed++;
    }
  }

  await fetchNavs(await listHoldings()).catch(() => {});
  // Decision 0031: SIP orders waiting for their NAV.
  const allotted = await fetchOrderNavs().catch(() => false);
  if (changed > 0 || allotted) notifyLedgerChange();
  return changed;
}

