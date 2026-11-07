/*
 * Offline support for the app shell. Data never goes through here: records
 * come from Puter and are cached by the app itself in IndexedDB.
 *
 * - Page loads: network first, falling back to the cached shell offline.
 * - Hashed build assets: cache first (their names change with every build).
 * - Other same-origin files (icons, manifest): stale while revalidate.
 * - The Puter SDK: network first, with a copy for starting offline.
 * - Other cross-origin requests (Puter's API) are never touched, and
 *   neither is the team worker source, which owners deploy from here.
 */
const SDK = 'https://js.puter.com/v2/';
// Filled in by the build (vite.config.js): this build's files, so the app
// opens offline after a single visit, and a cache per build, so the files
// of earlier builds are dropped.
const BUILD = 'dev';
const ASSETS = [];
const CACHE = `fleet-${BUILD}`;
const SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './favicon.ico'];

// This build's copy first: the previous build's cache is kept for a while,
// and caches.match() alone would find its older page and SDK first.
const cached = (req) => caches.open(CACHE).then((c) => c.match(req)).then((hit) => hit || caches.match(req));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll([...SHELL, ...ASSETS]);
        // The page loaded the SDK before this worker existed; keep a copy now.
        await fetch(SDK, { mode: 'no-cors' })
          .then((res) => cache.put(SDK, res))
          .catch(() => {});
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Keep the previous build's files as well (keys come oldest first): a
      // tab still running it may open a screen it has not loaded yet.
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).slice(0, -1).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.url === SDK) {
    // Without it a signed-in person can't open their fleet offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put(SDK, copy)));
          }
          return res;
        })
        .catch(() => cached(SDK).then((hit) => hit || Response.error())),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  // The team worker source is deployed from here and must always be current.
  if (url.pathname.includes('/worker/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only the app page itself becomes the offline shell, never an
          // error page or another file opened in a tab.
          if (res.ok && /text\/html/i.test(res.headers.get('content-type') || '')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => cached('./index.html')),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    cached(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    }),
  );
});
