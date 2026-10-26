import * as Crypto from 'expo-crypto';
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  addDays,
  casDate,
  casFlows,
  dateKey,
  dateOf,
  detectSip,
  fundValue,
  isFundPayee,
  pairFlows,
  paise,
  rupeesToPaise,
  scaleDecimal,
  startOfDate,
  FLOW_DAYS_AFTER,
  FLOW_DAYS_BEFORE,
  FLOW_TOLERANCE,
  type CasStatement,
  type DateKey,
  type FlowCandidate,
  type Paise,
} from '@money-plant/core';
import { accounts, holdings, navs, postings, transactions, type LocalHolding } from '@money-plant/db-schema';
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

/** NW-3: reads a CAS PDF through the parse-cas edge function. */
export async function readCas(file: PdfFile, password: string): Promise<CasStatement> {
  const data = await sendPdf<CasStatement>('parse-cas', file, password);
  if (!Array.isArray(data.folios)) throw new PdfError('not_a_cas');
  return data;
}

/** One scheme from a CAS, ready to show and save. */
export interface CasHolding {
  key: string;
  scheme: string;
  isin: string | null;
  amfiCode: string | null;
  folio: string | null;
  amc: string | null;
  unitsE4: number;
  cost: Paise;
  navE4: number | null;
  navDate: DateKey | null;
  value: Paise;
  asOf: DateKey;
  sip: { amount: Paise; day: number } | null;
  flows: ReturnType<typeof casFlows>;
}

/** The schemes still held, with units, cost and value as of the statement's end. Closed folios are left out. */
export function casHoldings(statement: CasStatement): CasHolding[] {
  const end = casDate(statement.statement.to) ?? today();
  const out: CasHolding[] = [];
  for (const folio of statement.folios) {
    for (const scheme of folio.schemes) {
      const unitsE4 = scaleDecimal(scheme.units, 4) ?? 0;
      if (unitsE4 <= 0 || !scheme.name) continue;
      const navE4 = scaleDecimal(scheme.valuation.nav, 4);
      const value = rupeesToPaise(scheme.valuation.value) ?? (navE4 !== null ? fundValue(unitsE4, navE4) : paise(0));
      const asOf = casDate(scheme.valuation.date) ?? end;
      const isin = scheme.isin && /^IN[A-Z0-9]{10}$/.test(scheme.isin) ? scheme.isin : null;
      const amfiCode = scheme.amfi && /^\d{1,10}$/.test(scheme.amfi) ? scheme.amfi : null;
      out.push({
        key: `${isin ?? amfiCode ?? scheme.name}:${folio.folio ?? ''}`,
        scheme: scheme.name.replace(/\s+/g, ' ').trim().slice(0, 200),
        isin,
        amfiCode,
        folio: folio.folio?.slice(0, 40) ?? null,
        amc: folio.amc?.slice(0, 120) ?? null,
        unitsE4,
        // The cost of the units still held; a statement without it falls back to the value.
        cost: rupeesToPaise(scheme.valuation.cost) ?? value,
        navE4,
        navDate: navE4 !== null ? asOf : null,
        value,
        asOf,
        sip: detectSip(scheme.transactions, asOf),
        flows: casFlows(scheme.transactions),
      });
    }
  }
  return out;
}

/** "Parag Parikh Flexi Cap Fund - Direct Plan - Growth" reads as "Parag Parikh Flexi Cap Fund". */
export function shortSchemeName(scheme: string): string {
  const name = scheme
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+-\s+/)[0]!
    .replace(/\s+/g, ' ')
    .trim();
  return (name || scheme).slice(0, 60);
}

/** Accounts that hold the user's money and can pay into a fund, so not funds, categories or people. */
function payingAccounts(db: Awaited<ReturnType<typeof getDb>>): Set<string> {
  return new Set(
    db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
      .all()
      .filter((a) => !['category', 'person', 'mutual_fund', 'stock', 'fd', 'rd'].includes(a.type))
      .map((a) => a.id),
  );
}

/** Expense and income entries in a date range that are one bank leg and one category leg, with the bank leg. */
function bankEntries(db: Awaited<ReturnType<typeof getDb>>, from: DateKey, to: DateKey) {
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
function toTransfer(db: Awaited<ReturnType<typeof getDb>>, tx: LedgerTransaction, leg: LedgerPosting, parts: { accountId: string; amount: Paise }[]): void {
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

/** Holdings whose account still exists. */
export async function listHoldings(): Promise<LocalHolding[]> {
  const db = await getDb();
  return db
    .select({ holding: holdings })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(and(isNull(holdings.deletedAt), isNull(accounts.deletedAt)))
    .all()
    .map((row) => row.holding);
}

export interface FundValue {
  /** Units at the latest NAV, plus money in or out since the statement. */
  value: Paise;
  /** What the units held on the statement date are worth now, less what they cost. */
  gain: Paise;
  navE4: number | null;
  navDate: DateKey | null;
}

/** The freshest NAV for a holding: AMFI's if it's newer than the statement's. */
async function latestNavs(): Promise<Map<string, { navE4: number; date: DateKey }>> {
  const db = await getDb();
  const out = new Map<string, { navE4: number; date: DateKey }>();
  for (const row of db.select().from(navs).all()) {
    out.set(row.amfiCode, { navE4: row.navE4, date: row.date });
    if (row.isin) out.set(row.isin, { navE4: row.navE4, date: row.date });
  }
  return out;
}

/** NW-1, NW-3: what each fund account is worth today, keyed by account id. `balances` are the accounts' ledger balances. */
export async function fundValues(balances: ReadonlyMap<string, Paise>): Promise<Map<string, FundValue>> {
  const latest = await latestNavs();
  const out = new Map<string, FundValue>();
  for (const holding of await listHoldings()) {
    const amfi = (holding.amfiCode && latest.get(holding.amfiCode)) || (holding.isin && latest.get(holding.isin)) || null;
    const nav = amfi && (!holding.navDate || amfi.date >= holding.navDate) ? amfi : holding.navE4 !== null ? { navE4: holding.navE4, date: holding.navDate! } : null;
    const market = nav ? fundValue(holding.unitsE4, nav.navE4) : paise(holding.costPaise);
    const balance = balances.get(holding.accountId) ?? paise(holding.costPaise);
    // Money in or out after the statement counts at what was paid, until the next CAS has its units.
    out.set(holding.accountId, {
      value: paise(market + balance - holding.costPaise),
      gain: paise(market - holding.costPaise),
      navE4: nav?.navE4 ?? null,
      navDate: nav?.date ?? null,
    });
  }
  return out;
}

/** Fetches today's NAVs for the funds held, once a day. AMFI publishes them late in the evening. */
async function fetchNavs(list: LocalHolding[]): Promise<void> {
  const fetched = await kvGet(NAV_FETCHED_KEY);
  if (fetched === today() || list.length === 0) return;
  const codes = [...new Set(list.map((h) => h.amfiCode).filter((c): c is string => !!c))];
  const isins = [...new Set(list.map((h) => h.isin).filter((c): c is string => !!c))];
  const { data, error } = await supabase.functions.invoke<{ navs: { code: string; isins: string[]; nav: string; date: string }[] }>('nav-prices', {
    body: { codes, isins },
  });
  if (error || !data) return;
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
  await kvSet(NAV_FETCHED_KEY, today());
}

/**
 * NW-3: keeps funds in step after an import.
 * - SIP debits after the statement, to a fund payee and of a fund's SIP
 *   amount, become transfers into that fund: one per fund a month, the fund
 *   whose SIP day is nearest when two share an amount.
 * - Today's NAVs are fetched once a day.
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
      const fits = list.filter(
        (h) => on > h.asOf && Math.abs(amount - h.sipPaise!) <= FLOW_TOLERANCE && !funded.has(`${h.accountId}|${on.slice(0, 7)}`) && isFundPayee(tx.counterparty, h.amc),
      );
      if (fits.length === 0) continue;
      const day = Number(on.slice(8, 10));
      const gap = (h: LocalHolding) => Math.min(Math.abs(day - h.sipDay!), 31 - Math.abs(day - h.sipDay!));
      const fund = fits.sort((a, b) => gap(a) - gap(b))[0]!;
      toTransfer(db, tx, leg, [{ accountId: fund.accountId, amount: paise(amount) }]);
      funded.add(`${fund.accountId}|${on.slice(0, 7)}`);
      changed++;
    }
  }

  await fetchNavs(await listHoldings()).catch(() => {});
  if (changed > 0) notifyLedgerChange();
  return changed;
}

