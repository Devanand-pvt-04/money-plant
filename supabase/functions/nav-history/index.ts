// NAV history edge function (NW-3, decision 0015).
//
// Returns each asked scheme's NAV on the last working day of each asked
// month, from AMFI's public NAV history report (free, no key). The phone keeps
// them in its local nav_history table and asks only for months it doesn't
// have, since past NAVs never change.
//
// The report for one day lists every scheme as
// `Code;Scheme name;ISIN growth;ISIN reinvest;NAV;Repurchase;Sale;Date`, mixed
// with headers and fund house names, so anything that isn't `digits;...;date`
// with a NAV is skipped. When a scheme is missing on a month's last weekday (a
// holiday), the day before is tried, up to four days back. NAVs go back as
// strings so the phone can scale them without floats.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const REPORT_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS: Record<string, string> = Object.fromEntries(MONTH_NAMES.map((m, i) => [m.toLowerCase(), String(i + 1).padStart(2, '0')]));

type Nav = { code: string; isins: string[]; nav: string; date: string };

function parseLine(line: string): Nav | null {
  const fields = line.split(';').map((field) => field.trim());
  if (fields.length < 5 || !/^\d+$/.test(fields[0])) return null;
  const date = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(fields[fields.length - 1]);
  if (!date || !MONTHS[date[2].toLowerCase()]) return null;
  const isins = fields.slice(2, 4).filter((isin) => /^IN[A-Z0-9]{10}$/.test(isin));
  // The NAV follows the two ISIN columns; older layouts put it second to last.
  const nav = [fields[4], fields[fields.length - 2]].find((value) => value !== undefined && /^\d+(\.\d+)?$/.test(value));
  if (!nav || Number(nav) <= 0) return null;
  return { code: fields[0], isins, nav, date: `${date[3]}-${MONTHS[date[2].toLowerCase()]}-${date[1]}` };
}

/** "2026-10" gives its last weekday, then the four days before it. */
function candidates(month: string): Date[] {
  const [year, m] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, m, 0));
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
  return Array.from({ length: 5 }, (_, i) => new Date(day.getTime() - i * 86_400_000));
}

const amfiDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${MONTH_NAMES[d.getUTCMonth()]}-${d.getUTCFullYear()}`;

/** Every scheme's NAV on one day, kept only for the schemes asked about. */
async function navsOn(day: Date, wanted: (nav: Nav) => boolean): Promise<Nav[]> {
  const date = amfiDate(day);
  const response = await fetch(`${REPORT_URL}?frmdt=${date}&todt=${date}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const text = await response.text();
  const out: Nav[] = [];
  for (const line of text.split(/\r?\n/)) {
    const nav = parseLine(line);
    if (nav && wanted(nav)) out.push(nav);
  }
  return out;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorised' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorised' }, 401);

  let body: { codes?: unknown; isins?: unknown; months?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const list = (value: unknown, pattern: RegExp, max: number) =>
    [...new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && pattern.test(item)) : [])].slice(0, max);
  const codes = new Set(list(body.codes, /^\d{1,10}$/, 100));
  const isins = new Set(list(body.isins, /^IN[A-Z0-9]{10}$/, 100));
  // Only past months: this month's NAV comes from nav-prices.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const months = list(body.months, /^\d{4}-(0[1-9]|1[0-2])$/, 12).filter((m) => m < thisMonth);
  if ((!codes.size && !isins.size) || months.length === 0) return json({ navs: [] });

  const asked = (nav: Nav) => codes.has(nav.code) || nav.isins.some((isin) => isins.has(isin));
  const total = codes.size + isins.size;
  const results = await Promise.all(
    months.map(async (month) => {
      const found = new Map<string, Nav>();
      for (const day of candidates(month)) {
        try {
          for (const nav of await navsOn(day, (n) => asked(n) && !found.has(n.code))) found.set(nav.code, nav);
        } catch (error) {
          console.error('nav-history fetch failed', month, (error as Error).message);
          break;
        }
        // Stop once every scheme asked about has a NAV (a code and an ISIN may name the same scheme).
        const covered = [...codes].filter((c) => found.has(c)).length + [...isins].filter((i) => [...found.values()].some((n) => n.isins.includes(i))).length;
        if (covered >= total) break;
      }
      return [...found.values()].map((nav) => ({ ...nav, month }));
    }),
  );
  return json({ navs: results.flat() });
});
