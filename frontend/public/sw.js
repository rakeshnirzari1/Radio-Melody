/* Radio Melody service worker — installable app shell + offline shell.
 *
 * Cache rules that matter for keeping the app current:
 *  - HTML/navigations are ALWAYS network-first, so a new deploy takes effect on
 *    the next load. The cached copy is only a fallback for a dead network.
 *  - Content-hashed assets (static/js/main.<hash>.js) are safe cache-first: the
 *    filename changes whenever the content does, so they can never go stale.
 *  - Shell paths resolve against this worker's scope instead of the origin root,
 *    so the app works when it is hosted from a subpath like /Radio-Melody/.
 *
 * Bump VERSION whenever the caching rules change; it purges the old caches on
 * activate, and the byte change is also what makes browsers install the new
 * worker at all.
 */
const VERSION = 'v4';
const CACHE = `radio-melody-${VERSION}`;
const SHELL = ['', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png'].map(
  (p) => new URL(p, self.registration.scope).toString()
);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((url) => c.add(url).catch(() => {}))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch cross-origin streams, and leave the relay/API alone.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  const accept = request.headers.get('accept') || '';
  const isHtml = request.mode === 'navigate' || accept.includes('text/html');

  if (isHtml) {
    // Network-first: a deploy is picked up on the very next load.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const c = await caches.open(CACHE);
          c.put(new URL('index.html', self.registration.scope).toString(), fresh.clone()).catch(
            () => {}
          );
          return fresh;
        } catch {
          const cached =
            (await caches.match(new URL('index.html', self.registration.scope).toString())) ||
            (await caches.match(new URL('', self.registration.scope).toString()));
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // The manifest is never served stale. iOS reads start_url out of it when you
  // add the app to the home screen, so a cached copy from before a fix installs
  // the app pointed at the wrong URL — which is exactly how it ended up saving
  // https://the app's own address/ instead of /Radio-Melody/.
  if (url.pathname.endsWith('/manifest.json')) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const c = await caches.open(CACHE);
          c.put(request, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          return (await caches.match(request)) || Response.error();
        }
      })()
    );
    return;
  }

  // Everything else same-origin: cache-first, which is only safe because the
  // build fingerprints asset filenames.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const resp = await fetch(request);
        if (resp && resp.ok) {
          const c = await caches.open(CACHE);
          c.put(request, resp.clone()).catch(() => {});
        }
        return resp;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});
