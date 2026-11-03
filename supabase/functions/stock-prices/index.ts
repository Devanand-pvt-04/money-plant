// Stock prices edge function (NW-5, NW-6, decision 0014).
//
// Returns the latest closing prices for the ISINs the caller holds, from the
// exchanges' public daily closing-price files (NSE first, BSE for anything
// NSE didn't have), and, when asked, every NPS scheme's latest NAV from the
// NPS central record keeper's daily file. Nothing is stored. Files are tried
// from today back a week, since weekends and holidays have none. Prices go
// back as strings so the phone can scale them without floats.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// The exchanges turn away requests that don't look like a browser.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  Accept: '*/*',
};
const LOOKBACK_DAYS = 7;

type Price = { isin: string; price: string; date: string };
type Nav = { name: string; nav: string; date: string };

/** Dates in India, newest first: today and the days before. */
function days(): Date[] {
  const ist = new Date(Date.now() + 5.5 * 60 * 60_000);
  return Array.from({ length: LOOKBACK_DAYS }, (_, i) => new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - i)));
}
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const dmy = (d: Date) => `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`;
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

async function fetchBytes(url: string, headers: Record<string, string> = {}): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { headers: { ...HEADERS, ...headers }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function firstFile(zip: Uint8Array): string | null {
  try {
    const files = unzipSync(zip);
    const name = Object.keys(files)[0];
    return name ? strFromU8(files[name]) : null;
  } catch {
    return null;
  }
}

/** A closing-price file in the exchanges' common format: columns named in the header, ISIN and ClsPric among them. */
function readBhavcopy(csv: string, wanted: ReadonlySet<string>, date: string): Price[] {
  const lines = csv.split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toUpperCase());
  const isinAt = header.indexOf('ISIN');
  const closeAt = header.findIndex((h) => h === 'CLSPRIC' || h === 'CLOSE' || h === 'CLOSE_PRICE');
  const dateAt = header.findIndex((h) => h === 'TRADDT' || h === 'TRADE_DATE');
  if (isinAt < 0 || closeAt < 0) return [];
  const out: Price[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.split(',').map((f) => f.trim());
    const isin = fields[isinAt];
    const price = fields[closeAt];
    if (!isin || !wanted.has(isin) || !/^\d+(\.\d+)?$/.test(price ?? '')) continue;
    const traded = dateAt >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(fields[dateAt] ?? '') ? fields[dateAt]! : date;
    out.push({ isin, price: price!, date: traded });
  }
  return out;
}

async function exchangePrices(isins: Set<string>): Promise<Price[]> {
  const found = new Map<string, Price>();
  for (const day of days()) {
    const nse = await fetchBytes(`https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ymd(day)}_F_0000.csv.zip`);
    const nseCsv = nse ? firstFile(nse) : null;
    if (nseCsv) for (const p of readBhavcopy(nseCsv, isins, iso(day))) if (!found.has(p.isin)) found.set(p.isin, p);
    const missing = new Set([...isins].filter((i) => !found.has(i)));
    if (missing.size > 0) {
      const bse = await fetchBytes(`https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${ymd(day)}_F_0000.CSV`, {
        Referer: 'https://www.bseindia.com/',
      });
      if (bse) for (const p of readBhavcopy(new TextDecoder().decode(bse), missing, iso(day))) found.set(p.isin, p);
    }
    // Stop at the newest trading day that had files; older days only fill gaps.
    if (nseCsv && found.size === isins.size) break;
  }
  return [...found.values()];
}

/**
 * NPS NAVs: comma-separated lines holding a date (dd/mm/yyyy), a scheme id
 * (SM followed by digits), the scheme's name after it, and the NAV last.
 */
function readNpsNavs(text: string, fallbackDate: string): Nav[] {
  const out: Nav[] = [];
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split(',').map((f) => f.trim());
    const idAt = fields.findIndex((f) => /^SM\d{6}$/i.test(f));
    const nav = fields[fields.length - 1];
    if (idAt < 0 || !fields[idAt + 1] || !/^\d+(\.\d+)?$/.test(nav ?? '')) continue;
    const date = fields.map((f) => /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f)).find(Boolean);
    out.push({ name: fields[idAt + 1]!, nav: nav!, date: date ? `${date[3]}-${date[2]}-${date[1]}` : fallbackDate });
  }
  return out;
}

async function npsNavs(): Promise<Nav[]> {
  for (const day of days()) {
    const zip = await fetchBytes(`https://npscra.nsdl.co.in/download/NAV_File_${dmy(day)}.zip`);
    const text = zip ? firstFile(zip) : null;
    const navs = text ? readNpsNavs(text, iso(day)) : [];
    if (navs.length > 0) return navs;
  }
  return [];
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorised' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorised' }, 401);

  let body: { isins?: unknown; nps?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const isins = new Set(
    Array.isArray(body.isins) ? body.isins.filter((i): i is string => typeof i === 'string' && /^IN[A-Z0-9]{10}$/.test(i)).slice(0, 300) : [],
  );
  const [prices, nps] = await Promise.all([isins.size > 0 ? exchangePrices(isins) : [], body.nps === true ? npsNavs() : []]);
  if (isins.size > 0 && prices.length === 0 && (body.nps !== true || nps.length === 0)) {
    console.error('stock-prices found nothing', isins.size);
    return json({ error: 'prices_unavailable' }, 502);
  }
  return json({ prices, nps });
});
