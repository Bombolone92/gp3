import { describe, it, expect, vi } from 'vitest';
import { createPuterBackend } from '../src/core/backend.js';
import { createStore } from '../src/core/store.js';

/**
 * A fake of the parts of puter.kv the backend uses, following the documented
 * semantics: prefix list with pagination and optional values, batch set,
 * and incr with a path map that returns the whole object.
 */
function fakeKV({ pageSize = 2 } = {}) {
  const data = new Map();
  const calls = { list: 0, set: 0, get: 0, incr: 0, del: 0 };
  return {
    data,
    calls,
    async get(key) {
      calls.get++;
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      calls.set++;
      if (Array.isArray(key)) for (const it of key) data.set(it.key, structuredClone(it.value));
      else data.set(key, structuredClone(value));
      return true;
    },
    async del(key) {
      calls.del++;
      data.delete(key);
      return true;
    },
    async incr(key, paths) {
      calls.incr++;
      const cur = data.get(key) || {};
      for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
      data.set(key, cur);
      return structuredClone(cur);
    },
    async list({ pattern, returnValues, limit, cursor }) {
      calls.list++;
      const keys = [...data.keys()].filter((k) => k.startsWith(pattern)).sort();
      const start = cursor ? Number(cursor) : 0;
      const size = Math.min(limit, pageSize);
      const slice = keys.slice(start, start + size);
      const next = start + size < keys.length ? String(start + size) : undefined;
      return { items: slice.map((k) => (returnValues ? { key: k, value: structuredClone(data.get(k)) } : k)), cursor: next };
    },
  };
}

describe('puter backend', () => {
  it('stores one KV item per record and pages through collections', async () => {
    const kv = fakeKV();
    const backend = createPuterBackend({ kv });
    await backend.putRecords('clients', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect([...kv.data.keys()].sort()).toEqual(['fs1:r:clients:a', 'fs1:r:clients:b', 'fs1:r:clients:c']);
    expect(kv.calls.set).toBe(1); // one batch request
    const loaded = await backend.loadCollection('clients');
    expect(loaded.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    expect(kv.calls.list).toBe(2); // two pages
  });

  it('does not leak records between collections sharing a prefix', async () => {
    const kv = fakeKV({ pageSize: 100 });
    const backend = createPuterBackend({ kv });
    await backend.putRecords('jobs', [{ id: '1' }]);
    await kv.set('fs1:r:jobsArchive:1', { id: 'x' });
    expect(await backend.loadCollection('jobs')).toEqual([{ id: '1' }]);
  });

  it('bumps versions and numbers atomically', async () => {
    const kv = fakeKV();
    const backend = createPuterBackend({ kv });
    expect(await backend.bumpVersions(['clients', 'jobs'])).toEqual({ clients: 1, jobs: 1 });
    expect(await backend.nextNumber('invoice')).toBe(1);
    expect(await backend.nextNumber('invoice')).toBe(2);
  });

  it('syncs two devices through the version map with minimal reads', async () => {
    const kv = fakeKV({ pageSize: 100 });
    const a = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0 });
    const b = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0 });
    await a.init();
    await b.init();
    a.put('clients', { firstName: 'Ada' });
    await a.flush();
    const listsBefore = kv.calls.list;
    await b.sync();
    expect(b.all('clients').map((c) => c.firstName)).toEqual(['Ada']);
    expect(kv.calls.list - listsBefore).toBe(1); // only clients re-read
    const before = kv.calls.list;
    await b.sync();
    expect(kv.calls.list).toBe(before); // nothing changed: one get, no lists
  });

  it('deletes many records without running into the request timeout', async () => {
    const kv = fakeKV({ pageSize: 1000 });
    const realDel = kv.del;
    kv.del = async (key) => (await new Promise((r) => setTimeout(r, 5)), realDel.call(kv, key));
    const store = createStore({ backend: createPuterBackend({ kv }), flushDelay: 1e9, timeoutMs: 400 });
    await store.init();
    store.bulkPut('timeEntries', Array.from({ length: 400 }, (_, i) => ({ minutes: i })));
    await store.flush();
    // Deleting all of them takes longer than one request may, so it must
    // go in parts that each finish in time.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.bulkRemove('timeEntries', store.all('timeEntries').map((r) => r.id));
    await store.flush();
    warn.mockRestore();
    expect(store.state.online).toBe(true);
    expect(store.pendingCount()).toBe(0);
    expect([...kv.data.keys()].filter((k) => k.includes(':timeEntries:'))).toHaveLength(0);
  });
});
