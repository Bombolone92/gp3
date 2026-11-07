import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const SOURCE = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

/** Load sw.js against fake self, caches and fetch; returns its fetch handler. */
function loadSW(fetchImpl) {
  const handlers = {};
  const puts = [];
  const cache = { put: async (k) => puts.push(String(k?.url || k)), addAll: async () => {} };
  const self = { location: { origin: 'https://app.example' }, addEventListener: (type, fn) => (handlers[type] = fn), skipWaiting() {}, clients: { claim() {} } };
  const caches = { open: async () => cache, match: async () => undefined, keys: async () => [] };
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, fetchImpl);
  const run = async (url, mode = 'no-cors') => {
    let responded = null;
    handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => (responded = p) });
    const res = responded && (await responded);
    await new Promise((r) => setTimeout(r, 0));
    return { responded: !!responded, res };
  };
  return { run, puts };
}

describe('service worker', () => {
  it('does not keep an error page as the offline app', async () => {
    const sw = loadSW(async () => ({ ok: false, status: 500, redirected: false, clone() {} }));
    await sw.run('https://app.example/', 'navigate');
    expect(sw.puts).toEqual([]);
    const ok = loadSW(async () => ({ ok: true, status: 200, redirected: false, clone() {} }));
    await ok.run('https://app.example/', 'navigate');
    expect(ok.puts).toEqual(['./index.html']);
  });

  it("leaves the team server's source to the network", async () => {
    const sw = loadSW(async () => ({ ok: true, clone() {} }));
    expect((await sw.run('https://app.example/worker/property-management-team-worker.js')).responded).toBe(false);
    expect((await sw.run('https://app.example/icons/icon-192.png')).responded).toBe(true);
  });
});
