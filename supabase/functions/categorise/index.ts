// Categorise edge function (architecture: AI services).
//
// The phone sends merchants it could not categorise with user rules, learned
// patterns or the built-in dictionary. This function answers from the shared
// merchants table, and records categories users confirm so the next person
// gets them from the dictionary.
//
// Misses go to the AI (decision 0012): each becomes a categorise job in
// ai_jobs, one per merchant across all users, which the worker on Deva's PC
// answers. Until it does, the merchant comes back in `pending` and the phone
// asks again on its next refresh. A finished answer is returned to anyone who
// asks for that merchant, and answers at SHARE_CONFIDENCE or more are also
// added to the merchants table by the ai-worker function. A user who turned
// AI off sends `ai: false`, and nothing of theirs is queued.
//
// It never receives raw SMS text, account numbers or phone numbers: only a
// cleaned merchant label, a business UPI ID, an amount band and a time of day.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

/** Answers at or above this are shared with everyone through the merchants table. */
const SHARE_CONFIDENCE = 0.8;
const MAX_ITEMS = 25;
/** AI answers are reused for this long; after it a merchant can be asked about again. */
const ANSWER_DAYS = 30;
const KEY_PATTERN = /^[a-z_]+(\.[a-z_]+)?$/;

interface Item {
  merchant: string;
  label: string;
  vpa: string | null;
  amountBand: string;
  timeOfDay: string;
  direction: 'debit' | 'credit';
}

interface Category {
  key: string;
  name: string;
}

interface Result {
  merchant: string;
  key: string | null;
  name: string | null;
  confidence: number;
  source: 'dictionary' | 'ai';
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function validItems(value: unknown): Item[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) return null;
  const items: Item[] = [];
  for (const raw of value) {
    const item = raw as Partial<Item>;
    if (typeof item.merchant !== 'string' || item.merchant.length === 0 || item.merchant.length > 80) return null;
    if (typeof item.label !== 'string' || item.label.length > 120) return null;
    // Belt and braces: the phone already strips digits that could identify an account or a person.
    if (/\d{6,}/.test(item.label) || (item.vpa && /\d{6,}/.test(item.vpa))) return null;
    items.push({
      merchant: item.merchant,
      label: item.label,
      vpa: typeof item.vpa === 'string' ? item.vpa.slice(0, 80) : null,
      amountBand: String(item.amountBand ?? '').slice(0, 40),
      timeOfDay: String(item.timeOfDay ?? '').slice(0, 20),
      direction: item.direction === 'credit' ? 'credit' : 'debit',
    });
  }
  return items;
}

function validCategories(value: unknown): Category[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) return null;
  const categories = value
    .map((c) => c as Partial<Category>)
    .filter((c): c is Category => typeof c.key === 'string' && KEY_PATTERN.test(c.key) && typeof c.name === 'string')
    .map((c) => ({ key: c.key, name: c.name.slice(0, 60) }));
  return categories.length > 0 ? categories : null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorised' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorised' }, 401);

  let body: { items?: unknown; categories?: unknown; confirm?: unknown; ai?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // A user confirmed a category for a merchant: share it, unless the dictionary already knows better.
  if (Array.isArray(body.confirm)) {
    const rows = body.confirm
      .slice(0, MAX_ITEMS)
      .map((c) => c as { merchant?: unknown; key?: unknown; name?: unknown })
      .filter((c) => typeof c.merchant === 'string' && c.merchant.length <= 80 && !/\d{6,}/.test(c.merchant) && typeof c.key === 'string' && KEY_PATTERN.test(c.key))
      .map((c) => ({
        normalised_name: c.merchant as string,
        display_name: typeof c.name === 'string' ? c.name.slice(0, 80) : null,
        category_key: c.key as string,
        confidence: SHARE_CONFIDENCE,
        created_by: 'user_confirmed',
      }));
    if (rows.length > 0) {
      const { error } = await admin.from('merchants').upsert(rows, { onConflict: 'normalised_name', ignoreDuplicates: true });
      if (error) return json({ error: 'database' }, 500);
    }
    return json({ confirmed: rows.length });
  }

  const items = validItems(body.items);
  const categories = validCategories(body.categories);
  if (!items || !categories) return json({ error: 'bad_request' }, 400);

  const { data: cached, error: lookupError } = await admin
    .from('merchants')
    .select('normalised_name, display_name, category_key, confidence')
    .in('normalised_name', items.map((i) => i.merchant))
    .is('deleted_at', null);
  if (lookupError) return json({ error: 'database' }, 500);
  const results: Result[] = (cached ?? []).map((row) => ({
    merchant: row.normalised_name,
    key: row.category_key,
    name: row.display_name,
    confidence: Number(row.confidence),
    source: 'dictionary' as const,
  }));
  let misses = items.filter((item) => !results.some((r) => r.merchant === item.merchant));
  if (misses.length === 0 || body.ai !== true) {
    // Not in the dictionary and no AI: answered as unknown, so the phone caches the miss and checks again later.
    for (const item of misses) results.push({ merchant: item.merchant, key: null, name: null, confidence: 0, source: 'dictionary' });
    return json({ results, pending: [] });
  }

  // What the AI already said, for this user or anyone else. Keys are standard, so they carry across users.
  const since = new Date(Date.now() - ANSWER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: done, error: doneError } = await admin
    .from('ai_jobs')
    .select('dedupe_key, result, finished_at')
    .eq('kind', 'categorise')
    .eq('status', 'done')
    .is('deleted_at', null)
    .gte('finished_at', since)
    .in('dedupe_key', misses.map((m) => m.merchant))
    .order('finished_at', { ascending: false });
  if (doneError) return json({ error: 'database' }, 500);
  const allowed = new Set(categories.map((c) => c.key));
  for (const row of done ?? []) {
    if (results.some((r) => r.merchant === row.dedupe_key)) continue;
    const answer = (row.result as { results?: { merchant: string; key: string | null; name: string | null; confidence: number }[] } | null)?.results?.[0];
    if (!answer || answer.merchant !== row.dedupe_key) continue;
    // A key this user has no category for is no answer for them.
    const key = answer.key && (allowed.has(answer.key) || allowed.has(answer.key.split('.')[0]!)) ? answer.key : null;
    results.push({ merchant: answer.merchant, key, name: answer.name, confidence: key ? answer.confidence : 0, source: 'ai' });
  }
  misses = misses.filter((item) => !results.some((r) => r.merchant === item.merchant));

  // Queue the rest. An open job for the same merchant (from anyone) already covers it.
  if (misses.length > 0) {
    const { error: queueError } = await admin.rpc('queue_categorise_jobs', { p_user_id: auth.user.id, p_items: misses, p_categories: categories });
    if (queueError) return json({ error: 'database' }, 500);
  }
  return json({ results, pending: misses.map((m) => m.merchant) });
});
