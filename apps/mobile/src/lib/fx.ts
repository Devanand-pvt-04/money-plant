import { inArray } from 'drizzle-orm';
import { DEFAULT_CURRENCY, isCurrency, type CurrencyCode, type FxRateRow } from '@money-plant/core';
import { fxRates } from '@money-plant/db-schema';
import { getDb } from './db';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';

/**
 * Exchange rates on the phone (decision 0017, NW-7). The fx-rates function
 * returns how many units of each currency a rupee buys, times 10^9, as text;
 * they are kept in fx_rates and read back as BigInt, never as floats.
 */

const TODAY_FETCHED_KEY = 'fx.todayFetchedAt';
const TODAY_EVERY_MS = 6 * 60 * 60 * 1000;
/** The function takes up to this many dates per call. */
const DATES_PER_CALL = 400;

type RemoteRate = { date: string; currency: string; per_inr_e9: string; rate_date: string };

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Asks the fx-rates function for these currencies on these days and keeps the answers. False if it couldn't. */
export async function requestRates(currencies: readonly CurrencyCode[], dates: readonly string[]): Promise<boolean> {
  const wanted = [...new Set(currencies)].filter((c) => c !== DEFAULT_CURRENCY && isCurrency(c));
  const days = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (wanted.length === 0 || days.length === 0) return true;
  const db = await getDb();
  for (let i = 0; i < days.length; i += DATES_PER_CALL) {
    const { data, error } = await supabase.functions.invoke<{ rates: RemoteRate[] }>('fx-rates', {
      body: { currencies: wanted, dates: days.slice(i, i + DATES_PER_CALL) },
    });
    if (error || !data) return false;
    db.transaction((t) => {
      for (const row of data.rates) {
        if (!wanted.includes(row.currency) || !/^\d+$/.test(row.per_inr_e9) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
        t.insert(fxRates)
          .values({ date: row.date, currency: row.currency, perInrE9: row.per_inr_e9, rateDate: row.rate_date })
          .onConflictDoUpdate({
            target: [fxRates.date, fxRates.currency],
            set: { perInrE9: row.per_inr_e9, rateDate: row.rate_date },
          })
          .run();
      }
    });
  }
  return true;
}

/**
 * Today's rates for these currencies, fetched at most every 6 hours, or
 * sooner when a currency is new. True when new rates were stored.
 */
export async function refreshTodayRates(currencies: readonly CurrencyCode[]): Promise<boolean> {
  const wanted = [...new Set(currencies)].filter((c) => c !== DEFAULT_CURRENCY).sort();
  if (wanted.length === 0) return false;
  const fetched = await kvGet(TODAY_FETCHED_KEY);
  const [at, list] = fetched?.split('|') ?? [];
  if (at && list === wanted.join(',') && Date.now() - Date.parse(at) < TODAY_EVERY_MS) return false;
  if (!(await requestRates(wanted, [todayKey()]))) return false;
  await kvSet(TODAY_FETCHED_KEY, `${new Date().toISOString()}|${wanted.join(',')}`);
  return true;
}

export { todayKey };

/** Every stored rate for these currencies, for rateOn and convertOn in @money-plant/core. */
export async function loadRates(currencies: readonly CurrencyCode[]): Promise<FxRateRow[]> {
  const wanted = [...new Set(currencies)].filter((c) => c !== DEFAULT_CURRENCY);
  if (wanted.length === 0) return [];
  const db = await getDb();
  const rows = db.select().from(fxRates).where(inArray(fxRates.currency, wanted)).all();
  return rows.map((row) => ({ date: row.date, currency: row.currency, perInrE9: BigInt(row.perInrE9) }));
}
