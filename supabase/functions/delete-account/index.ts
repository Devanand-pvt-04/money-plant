// Delete account edge function (ACC-4, architecture: consent and rights).
//
// Deletes the calling user's sign-in. Every user table references auth.users
// with on delete cascade, so all of their rows go with it. IOUs a friend
// recorded stay in the friend's ledger, with this user's link cleared.
//
// Only the caller's own account can be deleted: the user id comes from their
// token, never from the request body. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase; no other secrets.

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

  const { error } = await admin.auth.admin.deleteUser(auth.user.id);
  if (error) {
    console.error('delete-account failed', error.message);
    return json({ error: 'delete_failed' }, 500);
  }
  return json({ deleted: true });
});
