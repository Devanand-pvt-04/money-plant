// CORS for the edge functions the app calls (decision 0039). The phone app
// doesn't need it, but the iPhone web app runs in a browser, which first asks
// with an OPTIONS request and then refuses a response without these headers.
//
// Any origin may call: the functions are guarded by the caller's sign-in token,
// sent in the Authorization header, which another site's page doesn't have.
// No cookies are used, so `*` gives a page nothing it couldn't do already.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version',
  'Access-Control-Max-Age': '86400',
};

/** Deno.serve with CORS: answers the browser's OPTIONS request and adds the headers to every response. */
export function serveWithCors(handler: (request: Request) => Response | Promise<Response>): void {
  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    const response = await handler(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}
