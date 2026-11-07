/**
 * Second review of the first wave: the service worker keeps the previous
 * build's cache for a while, so offline answers must come from this
 * build's cache first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://fleet.example.com';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** CacheStorage with several named caches, matched in creation order like the real one. */
function cacheStorage() {
  const caches = new Map(); // name -> Map(url -> Response)
  const keyOf = (req) => new URL(typeof req === 'string' ? req : req.url, `${ORIGIN}/sw.js`).href;
  const cacheOf = (name) => {
    if (!caches.has(name)) caches.set(name, new Map());
    const store = caches.get(name);
    return {
      put: async (req, res) => void store.set(keyOf(req), res),
      match: async (req) => store.get(keyOf(req))?.clone(),
      addAll: async (list) => {
        for (const u of list) store.set(keyOf(u), new Response(`cached ${u}`));
      },
    };
  };
  return {
    caches,
    api: {
      open: async (name) => cacheOf(name),
      keys: async () => [...caches.keys()],
      delete: async (name) => caches.delete(name),
      match: async (req) => {
        for (const store of caches.values()) if (store.has(keyOf(req))) return store.get(keyOf(req)).clone();
        return undefined;
      },
    },
  };
}

function loadWorker(network, storage) {
  const listeners = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SOURCE, { self, caches: storage.api, fetch: async (req) => network(typeof req === 'string' ? req : req.url), Request, URL, Response, Promise, setTimeout });
  const run = (type) => new Promise((r) => listeners[type]({ waitUntil: (p) => p.then(r) }));
  async function request(path, { mode = 'no-cors' } = {}) {
    let responded = null;
    const url = /^https?:/.test(path) ? path : `${ORIGIN}${path}`;
    listeners.fetch({ request: { url, mode, method: 'GET' }, respondWith: (p) => (responded = p), waitUntil: () => {} });
    return responded ? await responded : null;
  }
  return { request, install: () => run('install'), activate: () => run('activate') };
}

describe('service worker after an update', () => {
  it('opens offline with this build, not the previous one it still keeps', async () => {
    const storage = cacheStorage();
    // What the previous build left behind.
    const old = await storage.api.open('fleet-previous');
    await old.put('./index.html', new Response('<!doctype html>old build'));
    await old.put('https://js.puter.com/v2/', new Response('old sdk'));

    let online = true;
    const sw = loadWorker(async (u) => {
      if (!online) throw new TypeError('Failed to fetch');
      if (u.startsWith('https://js.puter.com')) return new Response('new sdk');
      return new Response('<!doctype html>new build', { headers: { 'content-type': 'text/html' } });
    }, storage);
    await sw.install();
    await sw.activate();
    expect(storage.caches.has('fleet-previous')).toBe(true);
    await sw.request('/', { mode: 'navigate' });
    await tick();

    online = false;
    expect(await (await sw.request('/', { mode: 'navigate' })).text()).toBe('<!doctype html>new build');
    expect(await (await sw.request('https://js.puter.com/v2/')).text()).toBe('new sdk');
  });
});
