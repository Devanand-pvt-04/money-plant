// Parse CAS edge function (NW-3, architecture: CAS import).
//
// Forwards the signed-in user's CAS PDF and password to the Python CAS parser
// on Render and returns its trimmed holdings JSON. The service only accepts
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const file = form.get('file');
  const password = form.get('password');
  if (!(file instanceof File) || typeof password !== 'string') return json({ error: 'bad_request' }, 400);
  if (file.size > 10 * 1024 * 1024) return json({ error: 'too_large' }, 413);

  const upstream = new FormData();
  upstream.append('file', file, 'cas.pdf');
  upstream.append('password', password);
  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/cas`, {
      method: 'POST',
      headers: { 'X-Service-Token': serviceToken },
      body: upstream,
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('parse-cas upstream failed', (error as Error).name);
    return json({ error: 'service_unavailable' }, 502);
  }
});
