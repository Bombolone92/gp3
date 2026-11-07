import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const BASE = 'https://app.example/';

/** The service worker, run against in-memory caches and a scripted network. */
function boot(network) {
  const stores = new Map(); // cache name -> Map(url -> Response)
  const key = (r) => new URL(typeof r === 'string' ? r : r.url, BASE).href;
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (r, res) => void m.set(key(r), res),
      match: async (r) => m.get(key(r))?.clone(),
      addAll: async (list) => {
        for (const r of list) m.set(key(r), await fetchFn(key(r)));
      },
      keys: async () => [...m.keys()].map((u) => new Request(u)),
      delete: async (r) => m.delete(key(r)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (r) => {
      for (const m of stores.values()) if (m.has(key(r))) return m.get(key(r)).clone();
    },
  };
  const fetchFn = async (r) => {
    const res = network(key(r));
    if (!res) throw new TypeError('Failed to fetch');
    return res;
  };
  const listeners = {};
  const self = {
    location: new URL('sw.js', BASE),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetchFn);

  const waits = [];
  const lifecycle = async (type) => {
    listeners[type]({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits.splice(0));
  };
  const request = async (path, mode = 'no-cors') => {
    let response;
    listeners.fetch({
      request: { method: 'GET', url: key(path), mode },
      respondWith: (p) => (response = p),
      waitUntil: (p) => waits.push(p),
    });
    const res = await response;
    // Let the cache writes that follow a response finish.
    for (let i = 0; i < 5; i++) await Promise.all(waits.splice(0)).then(() => new Promise((r) => setTimeout(r)));
    return res;
  };
  return { stores, lifecycle, request };
}

const page = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

describe('offline shell', () => {
  let site;
  beforeEach(() => {
    site = { './': () => page('<script src="assets/index-a.js">'), 'assets/index-a.js': () => new Response('a') };
  });
  const network = (url) => {
    const path = url.slice(BASE.length) || './';
    return (site[path] || site[path === 'index.html' ? './' : null] || (() => new Response('', { status: 404 })))();
  };

  it('keeps the last good page for offline use when a load returns an error page', async () => {
    const sw = boot((url) => network(url));
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    expect(await (await sw.request('./', 'navigate')).text()).toContain('index-a.js');
    site['./'] = () => page('Service unavailable', 503);
    expect((await sw.request('./', 'navigate')).status).toBe(503);
    // Offline now: the shell must still be the app, not the error page.
    const offline = boot(() => null);
    for (const [name, m] of sw.stores) offline.stores.set(name, m);
    const res = await offline.request('./', 'navigate');
    expect(await res.text()).toContain('index-a.js');
  });

  it('drops build files from releases before the last one', async () => {
    const sw = boot((url) => network(url));
    await sw.lifecycle('install');
    await sw.lifecycle('activate');
    const cached = () => [...sw.stores.values()].flatMap((m) => [...m.keys()]).filter((u) => u.includes('/assets/')).sort();
    const release = async (name) => {
      site['./'] = () => page(`<script src="assets/index-${name}.js">`);
      site[`assets/index-${name}.js`] = () => new Response(name);
      await sw.request('./', 'navigate');
      expect(await (await sw.request(`assets/index-${name}.js`)).text()).toBe(name);
    };
    await release('a');
    await release('b');
    // A tab still open on the previous release can keep loading its files.
    expect(cached()).toEqual([`${BASE}assets/index-a.js`, `${BASE}assets/index-b.js`]);
    await release('c');
    expect(cached()).toEqual([`${BASE}assets/index-b.js`, `${BASE}assets/index-c.js`]);
    // Reloading the same release keeps its files.
    await sw.request('./', 'navigate');
    expect(cached()).toEqual([`${BASE}assets/index-b.js`, `${BASE}assets/index-c.js`]);
  });
});
