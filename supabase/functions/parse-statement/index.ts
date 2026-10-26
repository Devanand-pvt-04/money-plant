// Parse statement edge function (CAP-5, architecture: statement import).
//
// Forwards the signed-in user's bank statement PDF (and its password, if any)
// to the Python parser on Render and returns its rows. The service only accepts
// calls carrying CAS_SERVICE_TOKEN, which lives in edge function secrets and
// never in the app. Nothing is stored: the PDF and password pass straight
// through. Render's free tier sleeps, so the first call can take a minute.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'unauthorised' }, 401);
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'unauthorised' }, 401);

  const serviceUrl = Deno.env.get('CAS_SERVICE_URL');
  const serviceToken = Deno.env.get('CAS_SERVICE_TOKEN');
  if (!serviceUrl || !serviceToken) return json({ error: 'not_configured' }, 503);

  // The phone sends { pdf: base64, password } as JSON; React Native's multipart upload of picked files is unreliable.
  let body: { pdf?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const { pdf, password } = body;
  if (typeof pdf !== 'string' || (password !== undefined && typeof password !== 'string')) return json({ error: 'bad_request' }, 400);
  if (pdf.length * 0.75 > 10 * 1024 * 1024) return json({ error: 'too_large' }, 413);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const upstream = new FormData();
  upstream.append('file', new Blob([bytes], { type: 'application/pdf' }), 'statement.pdf');
  upstream.append('password', typeof password === 'string' ? password : '');
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/statement`, {
      method: 'POST',
      headers: { 'X-Service-Token': serviceToken },
      body: upstream,
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('parse-statement upstream failed', (error as Error).name);
    return json({ error: 'service_unavailable' }, 502);
  }
});
