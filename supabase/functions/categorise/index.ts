// Categorise edge function (architecture: AI services).
//
// The phone sends merchants it could not categorise with user rules, learned
// patterns or the built-in dictionary. This function answers from the shared
// merchants table when it can, and otherwise asks claude-haiku-5-5 once for
// the whole batch, under a per-user and a global monthly spend cap.
//
// It never receives raw SMS text, account numbers or phone numbers: only a
// cleaned merchant label, a business UPI ID, an amount band and a time of day.
//
// Secrets: ANTHROPIC_API_KEY. Optional: AI_MONTHLY_CAP_USD (default 5),
// AI_USER_MONTHLY_CAP_USD (default 1). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const MODEL = 'claude-haiku-5-5';
// Haiku 5.5 list prices: $0.10 per million input tokens, $0.50 per million output tokens.
// Cost in millionths of a dollar = (input + 5 * output) / 10, rounded up.
const costMicroUsd = (input: number, output: number) => Math.ceil((input + 5 * output) / 10);
/** Answers at or above this are shared with everyone through the merchants table. */
const SHARE_CONFIDENCE = 0.8;
const MAX_ITEMS = 25;
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
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
const usdToMicro = (name: string, fallback: number) => Math.round(Number(Deno.env.get(name) ?? fallback) * 1_000_000);
const GLOBAL_CAP = usdToMicro('AI_MONTHLY_CAP_USD', 5);
const USER_CAP = usdToMicro('AI_USER_MONTHLY_CAP_USD', 1);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SYSTEM = `You categorise merchants for an Indian personal finance app.
Each item is one merchant from a bank SMS or UPI app notification: a cleaned merchant label, sometimes a UPI ID, an amount band, the time of day, and whether money went out (debit) or came in (credit).
Pick the best category key from the list for each item. Use "unknown" when the label could be many kinds of business or you do not recognise it.
Return a short, clean merchant name as people know it (for example "Swiggy", "Indian Oil", "Apollo Pharmacy"), or the label tidied up if you do not know it.
Confidence is your probability, from 0 to 1, that the category is right. Give 0.8 or more only when you know this merchant or the label leaves no doubt.`;

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

async function askClaude(items: Item[], categories: Category[]): Promise<{ results: Result[]; input: number; output: number }> {
  const keys = [...new Set(categories.map((c) => c.key))];
  const schema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            key: { type: 'string', enum: [...keys, 'unknown'] },
            name: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['index', 'key', 'name', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['results'],
    additionalProperties: false,
  };
  const list = categories.map((c) => `${c.key}: ${c.name}`).join('\n');
  const lines = items.map((item, index) =>
    JSON.stringify({ index, label: item.label, upi_id: item.vpa, amount: item.amountBand, time: item.timeOfDay, direction: item.direction }),
  );
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: `Categories:\n${list}\n\nItems:\n${lines.join('\n')}` }],
  });
  const input = response.usage.input_tokens;
  const output = response.usage.output_tokens;
  if (response.stop_reason !== 'end_turn') return { results: [], input, output };
  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') return { results: [], input, output };
  const parsed = JSON.parse(text.text) as { results: { index: number; key: string; name: string; confidence: number }[] };
  const results: Result[] = [];
  for (const answer of parsed.results) {
    const item = items[answer.index];
    if (!item) continue;
    const known = answer.key !== 'unknown' && keys.includes(answer.key);
    results.push({
      merchant: item.merchant,
      key: known ? answer.key : null,
      name: answer.name.slice(0, 80) || null,
      confidence: known ? Math.min(1, Math.max(0, answer.confidence)) : 0,
      source: 'ai',
    });
  }
  return { results, input, output };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorised' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorised' }, 401);
  const userId = auth.user.id;

  let body: { items?: unknown; categories?: unknown; confirm?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  // A user confirmed a category the AI was unsure about: share it, unless the dictionary already knows better.
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
  const misses = items.filter((item) => !results.some((r) => r.merchant === item.merchant));
  if (misses.length === 0) return json({ results });

  const { data: usage, error: usageError } = await admin.rpc('ai_usage_this_month', { p_user_id: userId }).single();
  if (usageError || !usage) return json({ error: 'database' }, 500);
  const spent = usage as { user_cost_micro_usd: number; total_cost_micro_usd: number };
  if (Number(spent.total_cost_micro_usd) >= GLOBAL_CAP || Number(spent.user_cost_micro_usd) >= USER_CAP) {
    // Over the cap: answer from the dictionary only. The phone keeps the rest uncategorised and asks again next month.
    return json({ results, capped: true });
  }

  let answer: Awaited<ReturnType<typeof askClaude>>;
  try {
    answer = await askClaude(misses, categories);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
      return json({ results, retryLater: true });
    }
    console.error('categorise: Anthropic call failed', error instanceof Anthropic.APIError ? error.status : 'unknown');
    return json({ error: 'ai_failed' }, 502);
  }
  await admin.rpc('record_ai_usage', {
    p_user_id: userId,
    p_input_tokens: answer.input,
    p_output_tokens: answer.output,
    p_cost_micro_usd: costMicroUsd(answer.input, answer.output),
  });

  const share = answer.results
    .filter((r) => r.key !== null && r.confidence >= SHARE_CONFIDENCE)
    .map((r) => ({
      normalised_name: r.merchant,
      display_name: r.name,
      category_key: r.key!,
      confidence: Math.round(r.confidence * 100) / 100,
      created_by: 'ai',
    }));
  if (share.length > 0) {
    await admin.from('merchants').upsert(share, { onConflict: 'normalised_name', ignoreDuplicates: true });
  }
  return json({ results: [...results, ...answer.results] });
});
