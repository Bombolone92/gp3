/* Contacts service worker — offline app-shell support for the open web.
 *
 * Deliberately conservative: it ONLY touches same-origin GET requests for the
 * app's own static shell. Every cross-origin request — most importantly the
 * Puter SDK (js.puter.com) and all Puter API / KV / auth traffic — is left
 * entirely to the network, so this worker can never serve stale cloud data or
 * interfere with sign-in.
 *
 * Bump VERSION to purge the old cache on a deploy. (Freshness does not depend
 * on it: navigations and non-hashed assets are network-first, and build assets
 * under /assets/ are content-hashed, so a new deploy is picked up either way.)
 */
const VERSION = 'v2'
const CACHE = `contacts-shell-${VERSION}`

// The navigation shell + static brand assets. Hashed JS/CSS aren't listed here
// (their names change every build); they're cached on first request instead.
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon.svg',
  '/icon-48.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Best-effort per URL so a single missing file can't block installation.
      Promise.all(
        PRECACHE_URLS.map((url) =>
          fetch(new Request(url, { cache: 'reload' }))
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      )
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('contacts-shell-') && k !== CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // Only ever handle same-origin GETs. Everything else (Puter SDK, Puter API,
  // POSTs, …) goes straight to the network, untouched by this worker.
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Content-hashed build output is immutable → cache-first for speed/offline.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
            }
            return res
          })
      )
    )
    return
  }

  // Navigations → network-first so a fresh deploy's HTML always wins; fall back
  // to the cached shell only when the network is unavailable (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only a good response may become the offline shell — caching a
          // transient 404/500 page here would replace a working shell copy.
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {})
          }
          return res
        })
        .catch(() => caches.match('/').then((c) => c || caches.match(req)))
    )
    return
  }

  // Other same-origin GETs (manifest, icons, favicon) → network-first with a
  // cached fallback, so they're available offline but never go stale online.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req))
  )
})
