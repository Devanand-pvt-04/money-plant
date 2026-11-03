import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  addDays,
  brokerHolds,
  brokerOf,
  costFromAverage,
  dematGroups,
  dateKey,
  marketValue,
  npsKey,
  npsMatch,
  paise,
  scaleDecimal,
  startOfDate,
  type DateKey,
  type DematStatement,
  type MarketValue,
  type Paise,
} from '@money-plant/core';
import { accounts, holdings, prices, type LocalAccount, type LocalHolding } from '@money-plant/db-schema';
import { rebaseOpening } from '@money-plant/matcher';
import { getDb } from './db';
import { notifyLedgerChange } from './events';
import { bankEntries, latestNavs, requestNavs, toTransfer } from './funds';
import { derivedId } from './ids';
import { kvGet, kvSet } from './kv';
import { SqliteLedgerStore } from './ledger-store';
import { supabase } from './supabase';

const now = () => new Date().toISOString();
const PRICES_FETCHED_KEY = 'demat.prices.fetched';
const PRICES_EVERY_MS = 6 * 60 * 60_000;
/** Money moved to a broker this long before the first statement still counts as investing. */
const BROKER_LOOKBACK_DAYS = 365;

/** Account types whose value is several holdings at their latest prices (NW-5, NW-6). */
export const MARKET_TYPES = ['stock', 'nps'] as const;

/** ISINs of funds already held on mutual fund accounts from a CAMS or KFinTech CAS. */
export async function heldFundIsins(): Promise<Set<string>> {
  const db = await getDb();
  return new Set(
    db
      .select({ isin: holdings.isin })
      .from(holdings)
      .innerJoin(accounts, eq(accounts.id, holdings.accountId))
      .where(and(isNull(holdings.deletedAt), isNull(accounts.deletedAt), eq(accounts.type, 'mutual_fund')))
      .all()
      .map((r) => r.isin)
      .filter((i): i is string => !!i),
  );
}

/** Holdings on Stocks and NPS accounts that still exist, with their account. */
export async function listMarketHoldings(accountId?: string): Promise<(LocalHolding & { accountType: string })[]> {
  const db = await getDb();
  return db
    .select({ holding: holdings, type: accounts.type })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(
      and(
        isNull(holdings.deletedAt),
        isNull(accounts.deletedAt),
        inArray(accounts.type, [...MARKET_TYPES]),
        accountId ? eq(holdings.accountId, accountId) : undefined,
      ),
    )
    .all()
    .map((row) => ({ ...row.holding, accountType: row.type }));
}

/** The balance an account had on its statement's date: what its holdings cost, or stand in for. */
async function rebaseToHoldings(store: SqliteLedgerStore, accountId: string): Promise<void> {
  const list = (await listMarketHoldings(accountId)).filter((h) => h.unitsE4 > 0);
  const asOf = list.map((h) => h.asOf).sort().pop();
  if (!asOf) return;
  const baseline = list.reduce((sum, h) => sum + h.costPaise, 0);
  await store.setBalanceRef(accountId, { kind: 'user', balance: paise(baseline), at: startOfDate(addDays(asOf, 1)).toISOString() });
  await rebaseOpening(store, accountId);
}

export interface DematImportResult {
  accounts: number;
  holdings: number;
  transfers: number;
}

/**
 * NW-5, NW-6: saves a depository statement. Ids are derived from the
 * statement, so importing a newer one updates the same accounts and
 * holdings. A cost the user added is kept while the units stay the same;
 * a holding missing from the newer statement was sold and drops to zero.
 */
export async function importDemat(statement: DematStatement): Promise<DematImportResult> {
  const db = await getDb();
  const store = new SqliteLedgerStore(db);
  const groups = dematGroups(statement, await heldFundIsins());
  let count = 0;

  for (const group of groups) {
    const accountId = await derivedId(`market-account:${group.key}`);
    const existing = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!existing || existing.deletedAt) {
      const values = { type: group.type, name: group.name, institution: group.institution, last4: group.last4, deletedAt: null, dirty: 1 };
      db.insert(accounts)
        .values({ id: accountId, ...values, openingBalancePaise: 0, createdAt: now() })
        .onConflictDoUpdate({ target: accounts.id, set: { ...values, rev: sql`${accounts.rev} + 1` } })
        .run();
    }
    const before = new Map((await listMarketHoldings(accountId)).map((h) => [h.id, h]));
    const seen = new Set<string>();
    for (const item of group.items) {
      const id = await derivedId(`market-holding:${item.key}`);
      seen.add(id);
      const old = before.get(id);
      // A cost the user added still holds if the units haven't changed; otherwise it's asked for again.
      const keep = old && old.costKnown === 1 && old.unitsE4 === item.unitsE4 && !item.cost;
      const values = {
        accountId,
        kind: item.kind,
        scheme: item.name,
        isin: item.isin,
        amfiCode: item.amfiCode,
        symbol: item.symbol,
        folio: null,
        amc: group.institution,
        unitsE4: item.unitsE4,
        costPaise: keep ? old.costPaise : (item.cost ?? item.value),
        costKnown: keep || item.cost ? 1 : 0,
        navE4: item.priceE4,
        navDate: item.priceE4 !== null ? group.asOf : null,
        asOf: group.asOf,
        sipPaise: null,
        sipDay: null,
        deletedAt: null,
        dirty: 1,
      };
      db.insert(holdings)
        .values({ id, ...values, createdAt: now() })
        .onConflictDoUpdate({ target: holdings.id, set: { ...values, rev: sql`${holdings.rev} + 1` } })
        .run();
      count++;
    }
    for (const old of before.values()) {
      if (seen.has(old.id) || old.asOf >= group.asOf) continue;
      db.update(holdings)
        .set({ unitsE4: 0, costPaise: 0, costKnown: 1, asOf: group.asOf, dirty: 1, rev: sql`${holdings.rev} + 1` })
        .where(eq(holdings.id, old.id))
        .run();
    }
    await rebaseToHoldings(store, accountId);
  }

  await kvSet(PRICES_FETCHED_KEY, '');
  const transfers = await refreshDemat();
  notifyLedgerChange();
  return { accounts: groups.length, holdings: count, transfers };
}

export async function getHolding(id: string): Promise<LocalHolding | null> {
  const db = await getDb();
  return db.select().from(holdings).where(eq(holdings.id, id)).get() ?? null;
}

/** NW-5: what the user paid for a holding in all, or from the average price per unit. */
export async function setHoldingCost(holdingId: string, paid: { total: Paise } | { averagePriceE4: number }): Promise<void> {
  const db = await getDb();
  const holding = db.select().from(holdings).where(eq(holdings.id, holdingId)).get();
  if (!holding) return;
  const cost = 'total' in paid ? paid.total : costFromAverage(holding.unitsE4, paid.averagePriceE4);
  db.update(holdings)
    .set({ costPaise: cost, costKnown: 1, dirty: 1, rev: sql`${holdings.rev} + 1` })
    .where(eq(holdings.id, holdingId))
    .run();
  await rebaseToHoldings(new SqliteLedgerStore(db), holding.accountId);
  notifyLedgerChange();
}

/** The demat account a broker payee pays into: the one whose depository participant is that broker, or the only one. */
function dematFor(counterparty: string | null, demats: readonly LocalAccount[]): LocalAccount | null {
  const broker = brokerOf(counterparty);
  if (!broker) return null;
  const match = demats.filter((a) => brokerHolds(broker, a.institution));
  if (match.length === 1) return match[0]!;
  return demats.length === 1 ? demats[0]! : null;
}

/**
 * Keeps demat accounts in step:
 * - Money paid to or received from a known broker becomes a transfer into or
 *   out of the demat account, so buying shares isn't spending.
 * - Prices are fetched at most every 6 hours.
 * Returns the number of entries changed.
 */
export async function refreshDemat(): Promise<number> {
  const db = await getDb();
  const demats = db
    .select()
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), eq(accounts.type, 'stock')))
    .all()
    .filter((a) => a.institution);
  let changed = 0;
  const list = await listMarketHoldings();
  const firstAsOf = list.filter((h) => h.accountType === 'stock').map((h) => h.asOf).sort()[0];
  if (demats.length > 0 && firstAsOf) {
    for (const { tx, leg } of bankEntries(db, addDays(firstAsOf, -BROKER_LOOKBACK_DAYS), dateKey(new Date()))) {
      const demat = dematFor(tx.counterparty, demats);
      if (!demat) continue;
      toTransfer(db, tx, leg, [{ accountId: demat.id, amount: paise(Math.abs(leg.amount)) }]);
      changed++;
    }
  }
  await fetchPrices(list).catch(() => {});
  if (changed > 0) notifyLedgerChange();
  return changed;
}

async function fetchPrices(list: readonly LocalHolding[]): Promise<void> {
  const fetched = await kvGet(PRICES_FETCHED_KEY);
  if ((fetched && Date.now() - Date.parse(fetched) < PRICES_EVERY_MS) || list.length === 0) return;
  const held = list.filter((h) => h.unitsE4 > 0);
  const isins = [...new Set(held.filter((h) => h.kind !== 'fund' && h.kind !== 'nps' && h.isin).map((h) => h.isin!))];
  const nps = held.some((h) => h.kind === 'nps');
  const funds = held.filter((h) => h.kind === 'fund');
  const navsOk = await requestNavs(
    [...new Set(funds.map((h) => h.amfiCode).filter((c): c is string => !!c))],
    [...new Set(funds.map((h) => h.isin).filter((c): c is string => !!c))],
  );
  let pricesOk = true;
  if (isins.length > 0 || nps) {
    const { data, error } = await supabase.functions.invoke<{ prices: { isin: string; price: string; date: string }[]; nps: { name: string; nav: string; date: string }[] }>(
      'stock-prices',
      { body: { isins, nps } },
    );
    pricesOk = !error && !!data;
    if (data) {
      const db = await getDb();
      const rows = [
        ...data.prices.map((p) => ({ key: p.isin, price: p.price, date: p.date })),
        ...(data.nps ?? []).map((p) => ({ key: npsKey(p.name), price: p.nav, date: p.date })),
      ];
      db.transaction((t) => {
        for (const row of rows) {
          const priceE4 = scaleDecimal(row.price, 4);
          if (priceE4 === null || priceE4 <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
          t.insert(prices)
            .values({ key: row.key, priceE4, date: row.date })
            .onConflictDoUpdate({ target: prices.key, set: { priceE4, date: row.date } })
            .run();
        }
      });
    }
  }
  if (navsOk && pricesOk) await kvSet(PRICES_FETCHED_KEY, now());
}

export interface HoldingView {
  holding: LocalHolding;
  priceE4: number | null;
  priceDate: DateKey | null;
  value: Paise;
}

export interface MarketAccountValue extends MarketValue {
  holdings: HoldingView[];
}

/**
 * NW-1, NW-5, NW-6: what each Stocks and NPS account is worth today, keyed by
 * account id. A price newer than the statement's wins: closing prices for
 * shares, ETFs, gold bonds and bonds, the NPS NAV, AMFI's NAV for funds.
 */
export async function marketValues(balances: ReadonlyMap<string, Paise>): Promise<Map<string, MarketAccountValue>> {
  const list = (await listMarketHoldings()).filter((h) => h.unitsE4 > 0);
  const out = new Map<string, MarketAccountValue>();
  if (list.length === 0) return out;
  const db = await getDb();
  const fetched = new Map(db.select().from(prices).all().map((p) => [p.key, p]));
  const navs = await latestNavs();
  const npsNames = [...fetched.keys()].filter((k) => k.startsWith('nps:')).map((k) => k.slice(4));
  const latestOf = (h: LocalHolding): { priceE4: number; date: DateKey } | null => {
    if (h.kind === 'fund') {
      const nav = (h.amfiCode && navs.get(h.amfiCode)) || (h.isin && navs.get(h.isin)) || null;
      return nav ? { priceE4: nav.navE4, date: nav.date } : null;
    }
    const key = h.kind === 'nps' ? npsMatch(h.scheme, npsNames) : h.isin;
    const p = key ? fetched.get(h.kind === 'nps' ? npsKey(key) : key) : undefined;
    return p ? { priceE4: p.priceE4, date: p.date } : null;
  };
  const byAccount = new Map<string, LocalHolding[]>();
  for (const h of list) byAccount.set(h.accountId, [...(byAccount.get(h.accountId) ?? []), h]);
  for (const [accountId, own] of byAccount) {
    const latest = own.map(latestOf);
    const fresh = own.map((h, i) => (latest[i] && (!h.navDate || latest[i]!.date >= h.navDate) ? latest[i]! : null));
    const result = marketValue(
      own.map((h, i) => ({ unitsE4: h.unitsE4, statementPriceE4: h.navE4, latestPriceE4: fresh[i]?.priceE4 ?? null, costPaise: h.costPaise, costKnown: h.costKnown === 1 })),
      balances.get(accountId) ?? paise(own.reduce((sum, h) => sum + h.costPaise, 0)),
    );
    out.set(accountId, {
      ...result,
      holdings: own.map((h, i) => ({
        holding: h,
        priceE4: fresh[i]?.priceE4 ?? h.navE4,
        priceDate: fresh[i]?.date ?? h.navDate,
        value: result.values[i]!,
      })),
    });
  }
  return out;
}
