import { convertOn, DEFAULT_CURRENCY, type CurrencyCode, type FxRateRow } from '@money-plant/core';
import { notifyLedgerChange } from './events';
import { loadRates, requestRates } from './fx';
import { homeCurrency } from './home-currency';

/**
 * Totals in the home currency (decision 0017, NW-7): each amount converts at
 * the rate of its own day, so a past month's spending doesn't move when rates
 * do. Rates not yet on the phone are asked for in the background, and the
 * screens reload when they arrive; until then those amounts are left out and
 * listed in `missing`, never guessed.
 */
export interface HomeConverter {
  home: CurrencyCode;
  /** The amount in the home currency on that day, or null while no rate is known. */
  toHome(amount: number, currency: CurrencyCode | null | undefined, occurredAt: string): number | null;
  /** Currencies left out of a total so far because their rate isn't known yet. */
  missing: Set<CurrencyCode>;
}

/** Days already asked for in this run, so a failed day isn't asked again on every reload. */
const asked = new Set<string>();

/** "2026-11-08", the phone's own day for a timestamp. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A converter for these entries: loads their rates and asks for any day that is missing. */
export async function homeConverter(entries: readonly { currency?: CurrencyCode | null; occurredAt: string }[]): Promise<HomeConverter> {
  const home = homeCurrency();
  const missing = new Set<CurrencyCode>();
  const foreign = entries.filter((e) => (e.currency ?? DEFAULT_CURRENCY) !== home);
  let rates: FxRateRow[] = [];
  if (foreign.length > 0) {
    const currencies = [...new Set([...foreign.map((e) => e.currency ?? DEFAULT_CURRENCY), home])];
    rates = await loadRates(currencies);
    const stored = new Set(rates.map((r) => `${r.currency}|${r.date}`));
    const wanted = new Set<string>();
    const days = new Set<string>();
    for (const e of foreign) {
      const day = localDay(e.occurredAt);
      for (const currency of [e.currency ?? DEFAULT_CURRENCY, home]) {
        if (currency === DEFAULT_CURRENCY || stored.has(`${currency}|${day}`) || asked.has(`${currency}|${day}`)) continue;
        asked.add(`${currency}|${day}`);
        wanted.add(currency);
        days.add(day);
      }
    }
    if (days.size > 0) {
      requestRates([...wanted], [...days]).then((ok) => ok && notifyLedgerChange(), () => {});
    }
  }
  return {
    home,
    missing,
    toHome(amount, currency, occurredAt) {
      const from = currency ?? DEFAULT_CURRENCY;
      if (from === home) return amount;
      const converted = convertOn(rates, amount, from, home, localDay(occurredAt));
      if (converted === null) missing.add(from);
      return converted;
    },
  };
}
