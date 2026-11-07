/**
 * Development only: answers the fake Puter's read links
 * (https://api.puter.mock/token-read?...) from the harness's IndexedDB,
 * with the token checks and Range handling of Puter's /token-read, so the
 * review player streams and seeks the way it would against Puter.
 */
import { idbStorage, parseTokenRead, answerTokenRead } from './fake-store.js';

const API_ORIGIN = 'https://api.puter.mock';
const storage = idbStorage();
// The harness page shows what was asked for (window.__mock.reads).
const log = new BroadcastChannel('review-mock-reads');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // The app refers to its icons relative to its page; this page lives in /dev/.
  if (url.origin === self.location.origin && /^\/dev\/[^/]+\.(png|ico|json)$/.test(url.pathname)) {
    e.respondWith(fetch(url.pathname.replace(/^\/dev\//, '/')));
    return;
  }
  const parsed = parseTokenRead(e.request.url, API_ORIGIN);
  if (!parsed) return;
  e.respondWith((async () => {
    const res = await answerTokenRead(storage, parsed, e.request.headers.get('range'));
    // Cross-origin media from a service worker: allow the page to read it.
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Accept-Ranges', 'bytes');
    log.postMessage({ range: e.request.headers.get('range'), status: res.status, length: res.headers.get('Content-Length'), contentRange: res.headers.get('Content-Range') });
    return new Response(res.body, { status: res.status, headers });
  })());
});
