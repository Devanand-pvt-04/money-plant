// Exchange rates edge function (decision 0017, NW-7, architecture: Currencies).
//
// The phone asks for the currencies and dates it needs and keeps the answers.
// Rates come from Frankfurter (European Central Bank reference rates) and, for
// currencies the ECB doesn't publish (AED, SAR, QAR and others), from the
// fawazahmed0 currency API on jsDelivr. Both are free and need no key. Nothing
// is stored on the server.
//
// Each rate goes back as `per_inr_e9`: how many major units of the currency
// one rupee buys, times 10^9, as a decimal string, so the phone never handles
// a floating-point rate. A date with no published rate (a weekend, a holiday)
// gets the nearest earlier one, and says which day that was in `rate_date`.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const FRANKFURTER = 'https://api.frankfurter.dev/v1';
const FALLBACK = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api';
/** Currencies the ECB publishes, so Frankfurter has them. */
const ECB = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR',
  'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);
const MAX_CURRENCIES = 20;
const MAX_DATES = 400;
/** Fallback lookups are one request per date, so they are capped harder. */
const MAX_FALLBACK_DATES = 31;
const SCALE = 1_000_000_000n;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Rate = { date: string; currency: string; per_inr_e9: string; rate_date: string };

/** A decimal written as text, as an integer and a power of ten: "1.1678" -> [11678n, 4]. */
function decimal(value: unknown): [bigint, number] | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  // Shortest round-trip text, so 1.1678 stays "1.1678"; tiny numbers come back as "1e-7".
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (!match) return null;
  const [, whole, fraction = '', exponent = '0'] = match;
  return [BigInt(whole + fraction), fraction.length - Number(exponent)];
}

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** round(a / b), halves to even, for positive a and b. */
function divide(a: bigint, b: bigint): bigint {
  let q = a / b;
  const r = a % b;
  if (r * 2n > b || (r * 2n === b && q % 2n === 1n)) q += 1n;
  return q;
}

/** units of X per INR = (X per base) / (INR per base), times 10^9. */
function perInrE9(xPerBase: unknown, inrPerBase: unknown): string | null {
  const x = decimal(xPerBase);
  const inr = decimal(inrPerBase);
  if (!x || !inr) return null;
  // (x[0] / 10^x[1]) / (inr[0] / 10^inr[1]) * 10^9
  const shift = inr[1] - x[1];
  const numerator = x[0] * SCALE * (shift > 0 ? pow10(shift) : 1n);
  const denominator = inr[0] * (shift < 0 ? pow10(-shift) : 1n);
  const result = divide(numerator, denominator);
  return result > 0n ? result.toString() : null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return await response.json();
}

/** For each wanted date, the published day on or before it (within a week). */
function nearestEarlier(published: string[], wanted: string): string | null {
  let best: string | null = null;
  for (const day of published) if (day <= wanted && day >= addDays(wanted, -7) && (!best || day > best)) best = day;
  return best;
}

/** ECB currencies over the whole span of dates, in one request, against the euro. */
async function fromFrankfurter(currencies: string[], dates: string[], today: string): Promise<Rate[]> {
  const symbols = [...new Set(['INR', ...currencies])].filter((c) => c !== 'EUR').join(',');
  const byDay = new Map<string, Record<string, unknown>>();
  const historic = dates.filter((d) => d < today).sort();
  if (historic.length) {
    const body = (await getJson(
      `${FRANKFURTER}/${addDays(historic[0], -7)}..${historic[historic.length - 1]}?base=EUR&symbols=${symbols}`,
    )) as { rates?: Record<string, Record<string, unknown>> };
    for (const [day, rates] of Object.entries(body.rates ?? {})) byDay.set(day, rates);
  }
  if (dates.some((d) => d >= today)) {
    const body = (await getJson(`${FRANKFURTER}/latest?base=EUR&symbols=${symbols}`)) as {
      date?: string;
      rates?: Record<string, unknown>;
    };
    if (body.date && body.rates) byDay.set(body.date, body.rates);
  }
  const published = [...byDay.keys()];
  const out: Rate[] = [];
  for (const date of dates) {
    const day = date >= today ? published.sort().at(-1) ?? null : nearestEarlier(published, date);
    const rates = day ? byDay.get(day) : undefined;
    if (!day || !rates) continue;
    for (const currency of currencies) {
      const value = currency === 'EUR' ? 1 : rates[currency];
      const rate = perInrE9(value, rates.INR);
      if (rate) out.push({ date, currency, per_inr_e9: rate, rate_date: day });
    }
  }
  return out;
}

/** Any currency, one request per date, already against the rupee. */
async function fromFallback(currencies: string[], dates: string[], today: string): Promise<Rate[]> {
  const out: Rate[] = [];
  await Promise.all(
    dates.slice(0, MAX_FALLBACK_DATES).map(async (date) => {
      const tag = date >= today ? 'latest' : date;
      try {
        const body = (await getJson(`${FALLBACK}@${tag}/v1/currencies/inr.min.json`)) as {
          date?: string;
          inr?: Record<string, unknown>;
        };
        if (!body.inr || !body.date) return;
        for (const currency of currencies) {
          const rate = perInrE9(body.inr[currency.toLowerCase()], 1);
          if (rate) out.push({ date, currency, per_inr_e9: rate, rate_date: body.date });
        }
      } catch (error) {
        console.error('fx-rates fallback failed', date, (error as Error).message);
      }
    }),
  );
  return out;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorised' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorised' }, 401);

  let body: { currencies?: unknown; dates?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const strings = (value: unknown, pattern: RegExp, max: number) =>
    Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === 'string' && pattern.test(item)))].slice(0, max)
      : [];
  const currencies = strings(body.currencies, /^[A-Z]{3}$/, MAX_CURRENCIES).filter((c) => c !== 'INR');
  const today = new Date().toISOString().slice(0, 10);
  const dates = strings(body.dates, /^\d{4}-\d{2}-\d{2}$/, MAX_DATES).map((d) => (d > today ? today : d));
  if (!currencies.length || !dates.length) return json({ rates: [] });

  const ecb = currencies.filter((c) => ECB.has(c));
  const others = currencies.filter((c) => !ECB.has(c));
  const rates: Rate[] = [];
  let frankfurterFailed = false;
  if (ecb.length) {
    try {
      rates.push(...(await fromFrankfurter(ecb, dates, today)));
    } catch (error) {
      console.error('fx-rates frankfurter failed', (error as Error).message);
      frankfurterFailed = true;
    }
  }
  const viaFallback = frankfurterFailed ? currencies : others;
  if (viaFallback.length) rates.push(...(await fromFallback(viaFallback, dates, today)));
  if (!rates.length && (ecb.length || others.length)) return json({ error: 'rates_unavailable' }, 502);
  return json({ rates });
});
