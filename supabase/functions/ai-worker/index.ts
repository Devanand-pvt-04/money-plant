// AI worker edge function (decisions 0006 and 0012).
//
// The only door to the ai_jobs queue for the worker on Deva's PC. The worker
// polls it over HTTPS, so the PC makes outgoing calls only and needs no tunnel.
// Calls must carry AI_WORKER_TOKEN in X-Worker-Token; the token lives in edge
// function secrets and in the worker's .env on the PC, never in the app.
//
// Actions (POST, JSON):
//   { action: 'claim', limit, kinds }      → { jobs: [{ id, kind, payload, attempts }] }
//   { action: 'complete', id, result }     → { ok }
//   { action: 'fail', id, error }          → { ok }   (retried once, then failed)
//   { action: 'status' }                   → { queue: [{ kind, queued, running }] }
//
// Deployed with verify_jwt off (supabase/config.toml), because the worker
// signs in with its token rather than a user's session.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const MAX_RESULT_BYTES = 60_000;
/** Categorise answers at or above this are shared with everyone through the merchants table. */
const SHARE_CONFIDENCE = 0.8;
const KEY_PATTERN = /^[a-z_]+(\.[a-z_]+)?$/;

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const KINDS = new Set(['categorise', 'month_review', 'icon']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Compares in constant time, so the token can't be guessed a character at a time. */
async function sameToken(given: string, expected: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/**
 * A confident categorise answer joins the shared merchants table, so every
 * user's phone gets it from the dictionary (decision 0012). A merchant the
 * table already has (a user confirmed it, say) is left as it is.
 */
async function shareConfident(id: string): Promise<void> {
  const { data: job } = await admin.from('ai_jobs').select('kind, result').eq('id', id).single();
  if (job?.kind !== 'categorise') return;
  const answers = (job.result as { results?: { merchant: string; key: string | null; name: string | null; confidence: number }[] }).results ?? [];
  const rows = answers
    .filter((a) => a.key && KEY_PATTERN.test(a.key) && a.confidence >= SHARE_CONFIDENCE && a.merchant.length <= 80 && !/\d{6,}/.test(a.merchant))
    .map((a) => ({
      normalised_name: a.merchant,
      display_name: a.name?.slice(0, 80) ?? null,
      category_key: a.key!,
      confidence: Math.round(a.confidence * 100) / 100,
      created_by: 'ai',
    }));
  if (rows.length === 0) return;
  const { error } = await admin.from('merchants').upsert(rows, { onConflict: 'normalised_name', ignoreDuplicates: true });
  if (error) console.error('ai-worker: sharing an answer failed', error.code);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const expected = Deno.env.get('AI_WORKER_TOKEN');
  if (!expected || expected.length < 32) return json({ error: 'not_configured' }, 503);
  const given = request.headers.get('X-Worker-Token') ?? '';
  if (!(await sameToken(given, expected))) return json({ error: 'unauthorised' }, 401);

  let body: { action?: unknown; limit?: unknown; kinds?: unknown; id?: unknown; result?: unknown; error?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  switch (body.action) {
    case 'claim': {
      const limit = typeof body.limit === 'number' && Number.isInteger(body.limit) ? body.limit : 5;
      const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k): k is string => typeof k === 'string' && KINDS.has(k)) : [];
      if (kinds.length === 0) return json({ error: 'bad_request' }, 400);
      const { data, error } = await admin.rpc('claim_ai_jobs', { p_limit: limit, p_kinds: kinds });
      if (error) return json({ error: 'database' }, 500);
      const jobs = (data ?? []).map((job: { id: string; kind: string; payload: unknown; attempts: number }) => ({
        id: job.id,
        kind: job.kind,
        payload: job.payload,
        attempts: job.attempts,
      }));
      return json({ jobs });
    }
    case 'complete': {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return json({ error: 'bad_request' }, 400);
      if (typeof body.result !== 'object' || body.result === null || Array.isArray(body.result)) return json({ error: 'bad_request' }, 400);
      if (JSON.stringify(body.result).length > MAX_RESULT_BYTES) return json({ error: 'too_large' }, 413);
      const { data, error } = await admin.rpc('complete_ai_job', { p_id: body.id, p_result: body.result });
      if (error) return json({ error: 'database' }, 500);
      if (data === true) await shareConfident(body.id);
      return json({ ok: data === true });
    }
    case 'fail': {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return json({ error: 'bad_request' }, 400);
      const reason = typeof body.error === 'string' ? body.error.slice(0, 200) : 'failed';
      const { data, error } = await admin.rpc('fail_ai_job', { p_id: body.id, p_error: reason });
      if (error) return json({ error: 'database' }, 500);
      return json({ ok: data === true });
    }
    case 'status': {
      const { data, error } = await admin.rpc('ai_queue_counts');
      if (error) return json({ error: 'database' }, 500);
      return json({ queue: data ?? [] });
    }
    default:
      return json({ error: 'bad_request' }, 400);
  }
});
