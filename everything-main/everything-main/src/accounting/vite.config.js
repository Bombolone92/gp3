import { defineConfig } from 'vite';
import puterLocalhost from '../../dev/puter-localhost.mjs';

/**
 * Writes sw.js from the bundle that was just built, so the app shell (HTML,
 * hashed JS and CSS, icons) is precached under a name that changes with the
 * build. With the books in IndexedDB, that is everything needed to open the
 * app without a connection. Generated, not hand-written, because asset names
 * are hashed.
 */
function serviceWorker() {
  return {
    name: 'bookkeeping-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle).filter((name) => /\.(js|css)$/.test(name)).map((name) => `./${name}`);
      const shell = ['./', './index.html', './manifest.json', './favicon.ico', './favicon-16x16.png', './favicon-32x32.png', './favicon-48x48.png', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './app-icon.png', ...assets];
      const version = `v${hash(shell.join('|'))}`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(version, shell) });
    },
  };
}

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function swSource(version, shell) {
  return `/* Generated at build time by vite.config.js. Do not edit. */
const CACHE = 'bookkeeping-${version}';
const SHELL = ${JSON.stringify(shell)};
const SDK = 'https://js.puter.com/';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('bookkeeping-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok) (await caches.open(CACHE)).put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
  if (request.url.startsWith(SDK)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        (await caches.open(CACHE)).put(request, response.clone());
        return response;
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })());
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') (await caches.open(CACHE)).put(request, response.clone());
      return response;
    })());
  }
  /* Calls to the user's Puter cloud always go to the network. */
});
`;
}

export default defineConfig({
  base: './',
  plugins: [puterLocalhost('accounting'), serviceWorker()],
  build: {
    target: 'es2022',
    cssTarget: 'safari15',
  },
  server: {
    port: 5181,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
