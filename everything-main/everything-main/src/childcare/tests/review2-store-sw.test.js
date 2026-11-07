/**
 * Second review: the service worker. Runs public/sw.js against fake caches
 * and fetch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://childcare.example';

function loadWorker({ network }) {
  const handlers = {};
  const store = new Map(); // url -> Response
  const keyOf = (req) => new URL(typeof req === 'string' ? req : req.url, `${ORIGIN}/`).href;
  const cache = {
    async put(req, res) {
      store.set(keyOf(req), res);
    },
    async match(req) {
      return store.get(keyOf(req))?.clone();
    },
    async addAll() {},
  };
  const caches = {
    open: async () => cache,
    match: (req) => cache.match(req),
    keys: async () => ['childcare-v1'],
    delete: async () => true,
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch: (req) => network(req), URL, Response, Request, Promise, console });
  async function request(url, init = {}, mode = 'cors') {
    const req = new Request(new URL(url, `${ORIGIN}/`).href, init);
    Object.defineProperty(req, 'mode', { value: mode });
    let responded = null;
    handlers.fetch({ request: req, respondWith: (p) => (responded = p) });
    const res = await responded;
    await new Promise((r) => setTimeout(r, 5)); // let background cache writes finish
    return res;
  }
  return { request, store };
}

describe('service worker', () => {
  it('fetches the team worker bundle from the network when asked to revalidate', async () => {
    let build = 'aaa';
    const sw = loadWorker({ network: async () => new Response(`// childcare-team-worker build=${build}`) });
    await sw.request('/worker/childcare-team-worker.js', { cache: 'no-cache' });
    build = 'bbb'; // the app was updated
    const res = await sw.request('/worker/childcare-team-worker.js', { cache: 'no-cache' });
    expect(await res.text()).toContain('build=bbb');
  });

  it('does not keep an error page as the offline app shell', async () => {
    let status = 200;
    const sw = loadWorker({
      network: async () =>
        status === 200
          ? new Response('<!doctype html><title>Childcare</title>', { headers: { 'content-type': 'text/html' } })
          : new Response('Service unavailable', { status, headers: { 'content-type': 'text/plain' } }),
    });
    await sw.request('/', {}, 'navigate');
    status = 503; // a deploy in progress
    await sw.request('/', {}, 'navigate');
    expect(await sw.store.get(`${ORIGIN}/index.html`).clone().text()).toContain('<title>Childcare</title>');
  });

  it('does not keep a non-page navigation (an icon opened in a tab) as the app shell', async () => {
    const sw = loadWorker({
      network: async (req) =>
        new URL(req.url).pathname.endsWith('.png')
          ? new Response('PNG', { headers: { 'content-type': 'image/png' } })
          : new Response('<!doctype html><title>Childcare</title>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
    });
    await sw.request('/', {}, 'navigate');
    await sw.request('/icons/icon-512.png', {}, 'navigate');
    expect(await sw.store.get(`${ORIGIN}/index.html`).clone().text()).toContain('<title>Childcare</title>');
  });
});
