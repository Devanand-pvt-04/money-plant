// Web build (decision 0039): lets the iPhone web app open with no signal.
// The ledger already works offline (decision 0035); this keeps the app's own
// files. On install it stores every file of the build, listed in
// precache.json (written by scripts/web-precache.mjs after `expo export`).
// Built files have a hash in their name, so they are served from the store;
// the page itself is fetched fresh when online and taken from the store when
// not. Calls to Supabase are never stored.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `money-plant-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const list = await fetch('/precache.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : []), () => []);
      await cache.addAll(['/', ...list]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('money-plant-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Every route is the same single page; offline, the stored one opens.
    event.respondWith(
      fetch(request).then(
        (response) => {
          if (response.ok) caches.open(CACHE).then((c) => c.put('/', response.clone()));
          return response;
        },
        async () => (await caches.match('/')) || Response.error(),
      ),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const stored = await caches.match(request);
      if (stored) return stored;
      const response = await fetch(request);
      if (response.ok && (url.pathname.startsWith('/_expo/') || url.pathname.startsWith('/assets/'))) {
        const copy = response.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return response;
    })(),
  );
});
