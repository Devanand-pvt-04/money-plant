// NAV prices edge function (NW-3, architecture: prices).
//
// Returns today's NAVs for the schemes the caller asks about, from AMFI's
// public NAVAll.txt. The phone keeps the NAVs locally and asks once a day.
// Lines look like `Code;ISIN growth;ISIN reinvest;Scheme;NAV;Date`, mixed with
// headers and AMC names, so anything that isn't `digits;...;number;date` is
// skipped. NAVs go back as strings so the phone can scale them without floats.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

type Nav = { code: string; isins: string[]; nav: string; date: string };

function parseLine(line: string): Nav | null {
  const fields = line.split(';').map((field) => field.trim());
  if (fields.length < 5 || !/^\d+$/.test(fields[0])) return null;
  const nav = fields[fields.length - 2];
  const date = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(fields[fields.length - 1]);
  if (!/^\d+(\.\d+)?$/.test(nav) || !date || !MONTHS[date[2].toLowerCase()]) return null;
  const isins = fields.slice(1, 3).filter((isin) => /^IN[A-Z0-9]{10}$/.test(isin));
  return { code: fields[0], isins, nav, date: `${date[3]}-${MONTHS[date[2].toLowerCase()]}-${date[1]}` };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorised' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorised' }, 401);

  let body: { codes?: unknown; isins?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const list = (value: unknown) =>
    new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 200) : []);
  const codes = list(body.codes);
  const isins = list(body.isins);
  if (!codes.size && !isins.size) return json({ navs: [] });

  let text: string;
  try {
    const response = await fetch(AMFI_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    text = await response.text();
  } catch (error) {
    console.error('nav-prices fetch failed', (error as Error).message);
    return json({ error: 'amfi_unavailable' }, 502);
  }

  const navs = [];
  for (const line of text.split(/\r?\n/)) {
    const nav = parseLine(line);
    if (nav && (codes.has(nav.code) || nav.isins.some((isin) => isins.has(isin)))) navs.push(nav);
  }
  return json({ navs });
});
