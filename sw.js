/* IFR Study Guide service worker: cache-first, stale-while-revalidate.
   All paths are relative to this file, so it works at a domain root or under a subpath
   such as https://<user>.github.io/<repo>/ */
const CACHE = 'ifr-study-v4';
const BASE = new URL('./', self.location).href;               // e.g. https://user.github.io/repo/
const INDEX = new URL('index.html', BASE).href;
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']
  .map(p => new URL(p, BASE).href);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' bypasses the HTTP cache; store clean (non-redirected) copies.
    await Promise.all(ASSETS.map(async url => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache failed: ' + url);
      await cache.put(url, await clean(res));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('ifr-study-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// iOS Safari refuses redirected responses for navigations; rebuild a fresh Response.
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

function revalidate(cacheKey, request) {
  return fetch(request, { cache: 'no-cache' }).then(async res => {
    if (res && res.ok && res.type === 'basic') {
      const cache = await caches.open(CACHE);
      await cache.put(cacheKey, await clean(res.clone()));
    }
    return res;
  }).catch(() => undefined);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(BASE)) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = (await caches.match(INDEX, { ignoreSearch: true })) ||
                     (await caches.match(BASE, { ignoreSearch: true }));
      const update = revalidate(INDEX, INDEX);
      if (cached) { event.waitUntil(update); return cached; }
      const net = await update;
      return net || new Response('<h1>Offline</h1><p>Open the app once while online.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const key = url.origin + url.pathname;
    const update = revalidate(key, req);
    if (cached) { event.waitUntil(update); return cached; }
    return (await update) || new Response('', { status: 504 });
  })());
});
