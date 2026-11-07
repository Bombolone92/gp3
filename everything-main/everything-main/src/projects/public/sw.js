/**
 * Service worker: enough to boot the app with no connection, and nothing
 * more. It caches the shell — this app's own HTML, JS, CSS and icons, plus
 * the Puter SDK it cannot start without — and never caches a single byte of
 * anyone's data.
 *
 * That line matters: project documents, the KV index and attachments all
 * travel over the Puter API, and a stale copy served silently from a cache
 * would be worse than an error. The app mirrors its own data to IndexedDB
 * (src/lib/mirror.js), where it is explicitly marked as offline; this file
 * stays out of it.
 */

const VERSION = 'pm-shell-v2';
const SDK = 'https://js.puter.com/';

/**
 * Only the entry documents are known by name; assets are hashed. The two
 * icons listed are the ones the app itself draws — the tab icon and the mark
 * in the sidebar, splash and sign-in page. The 512s and the maskable are for
 * the installer, not for running offline, so they are left to be cached on
 * first use rather than paid for on install.
 */
const SHELL = [
  './', './index.html', './manifest.webmanifest', './favicon-32.png', './icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Best effort: one unreachable file must not fail the whole install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isAsset = (url) => /\.(?:js|css|svg|png|jpe?g|webp|woff2?|ico)$/.test(url.pathname);

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) {
    // Hashed build assets never change under their name; refresh anything
    // else quietly in the background.
    if (!/-[A-Za-z0-9_-]{8,}\./.test(new URL(request.url).pathname)) {
      fetch(request).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      }).catch(() => {});
    }
    return hit;
  }
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function navigationFallback(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(VERSION);
      cache.put('./index.html', res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cache = await caches.open(VERSION);
    return (await cache.match(request))
      ?? (await cache.match('./index.html'))
      ?? Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // The app's own data never comes from here.
  if (url.origin !== self.location.origin && !request.url.startsWith(SDK)) return;
  if (url.origin === self.location.origin && !isAsset(url) && request.mode !== 'navigate') return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationFallback(request));
    return;
  }
  event.respondWith(cacheFirst(request).catch(() => caches.match(request)));
});
