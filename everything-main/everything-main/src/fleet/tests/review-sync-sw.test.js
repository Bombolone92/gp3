/**
 * The offline app shell service worker, run against fake caches and fetch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://fleet.example.com';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function loadWorker(network, source = SOURCE) {
  const store = new Map(); // url -> Response
  const keyOf = (req) => new URL(typeof req === 'string' ? req : req.url, `${ORIGIN}/sw.js`).href;
  const cache = {
    put: async (req, res) => void store.set(keyOf(req), res),
    match: async (req) => store.get(keyOf(req))?.clone(),
    addAll: async (list) => {
      for (const u of list) store.set(keyOf(u), new Response(`cached ${u}`));
    },
  };
  const listeners = {};
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const context = {
    self,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: (req) => cache.match(req) },
    fetch: async (req) => network(typeof req === 'string' ? req : req.url),
    Request,
    URL,
    Response,
    Promise,
  };
  vm.runInNewContext(source, context);
  async function request(path, { mode = 'no-cors', method = 'GET' } = {}) {
    let responded = null;
    const url = /^https?:/.test(path) ? path : `${ORIGIN}${path}`;
    listeners.fetch({ request: { url, mode, method }, respondWith: (p) => (responded = p), waitUntil: () => {} });
    return responded ? await responded : null;
  }
  return { store, request, install: () => new Promise((r) => listeners.install({ waitUntil: (p) => p.then(r) })) };
}

describe('service worker', () => {
  it('never serves the team worker source from its cache', async () => {
    let build = 1;
    const sw = loadWorker(async () => new Response(`// fleet-team-worker build=${build}`));
    await sw.install();
    const first = await sw.request('/worker/fleet-team-worker.js');
    // Either the request is left to the network, or the answer is current.
    if (first) expect(await first.text()).toContain('build=1');
    await tick();
    build = 2;
    const second = await sw.request('/worker/fleet-team-worker.js');
    if (second) expect(await second.text()).toContain('build=2');
  });

  it('does not keep an error page as the offline app shell', async () => {
    let online = true;
    let status = 200;
    const sw = loadWorker(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(status === 200 ? '<!doctype html>app' : '<!doctype html>Bad gateway', { status, headers: { 'content-type': 'text/html' } });
    });
    await sw.install();
    await sw.request('/', { mode: 'navigate' });
    await tick();
    status = 502;
    await sw.request('/', { mode: 'navigate' });
    await tick();
    online = false;
    const offline = await sw.request('/', { mode: 'navigate' });
    expect(await offline.text()).toBe('<!doctype html>app');
  });

  it('stores the whole app at install, so it opens offline after a single visit', async () => {
    const { swPrecache } = await import('../vite.config.js');
    expect(typeof swPrecache).toBe('function');
    const dir = mkdtempSync(join(tmpdir(), 'fleet-sw-'));
    try {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'assets/index-AAAA1111.js'), '');
      writeFileSync(join(dir, 'assets/index-BBBB2222.css'), '');
      writeFileSync(join(dir, 'assets/dashboard-CCCC3333.js'), '');
      copyFileSync(new URL('../public/sw.js', import.meta.url), join(dir, 'sw.js'));
      const plugin = swPrecache();
      plugin.configResolved({ root: dir, build: { outDir: dir } });
      plugin.closeBundle();
      const built = readFileSync(join(dir, 'sw.js'), 'utf8');
      const sw = loadWorker(async (u) => new Response(`network ${u}`), built);
      await sw.install();
      for (const f of ['assets/index-AAAA1111.js', 'assets/index-BBBB2222.css', 'assets/dashboard-CCCC3333.js']) expect(sw.store.has(`${ORIGIN}/${f}`)).toBe(true);
      // Each build gets its own cache, so old builds' files are dropped.
      expect(built).not.toBe(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a copy of the Puter SDK so a signed-in start works offline', async () => {
    let online = true;
    const sw = loadWorker(async (u) => {
      if (!online) throw new TypeError('Failed to fetch');
      return new Response(`sdk from ${u}`);
    });
    await sw.install();
    expect(sw.store.has('https://js.puter.com/v2/')).toBe(true);
    const first = await sw.request('https://js.puter.com/v2/');
    expect(await first.text()).toBe('sdk from https://js.puter.com/v2/');
    await tick();
    online = false;
    const offline = await sw.request('https://js.puter.com/v2/');
    expect(await offline?.text()).toBe('sdk from https://js.puter.com/v2/');
    // Puter's API itself is never cached.
    expect(await sw.request('https://api.puter.com/whoami')).toBe(null);
  });
});
