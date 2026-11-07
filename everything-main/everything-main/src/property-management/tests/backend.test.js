import { describe, it, expect } from 'vitest';
import { createPuterBackend, PREFIX } from '../src/core/backend.js';
import { createStore } from '../src/core/store.js';

/**
 * kv.incr on a path map, as Puter documents it: dots in a path nest
 * ("a.b" -> { a: { b } }) and ["a.b"] names one field with a dot in it.
 */
function incrPaths(cur, paths) {
  for (const [p, n] of Object.entries(paths)) {
    const quoted = /^\["(.*)"\]$/.exec(p);
    const parts = quoted ? [quoted[1]] : p.split('.');
    let o = cur;
    for (const k of parts.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
    const last = parts[parts.length - 1];
    o[last] = (o[last] || 0) + n;
  }
  return cur;
}

/**
 * A small stand-in for puter.kv with the behaviour the backend relies on:
 * prefix list with paging (pattern ends in ':' or '*'), batch set, and incr
 * on nested paths. Counts calls so tests can check the access pattern.
 */
function fakeKV({ pageSize = 3 } = {}) {
  const m = new Map();
  const calls = { list: 0, set: 0, get: 0, del: 0, incr: 0 };
  return {
    calls,
    raw: m,
    async get(k) {
      calls.get++;
      return m.has(k) ? structuredClone(m.get(k)) : null;
    },
    async set(k, v) {
      calls.set++;
      if (Array.isArray(k)) for (const it of k) m.set(it.key, structuredClone(it.value));
      else m.set(k, structuredClone(v));
      return true;
    },
    async del(k) {
      calls.del++;
      m.delete(k);
      return true;
    },
    async incr(k, paths) {
      calls.incr++;
      const cur = incrPaths(m.get(k) || {}, paths);
      m.set(k, cur);
      return structuredClone(cur);
    },
    async list({ pattern, returnValues, limit = 1000, cursor }) {
      calls.list++;
      const prefix = pattern.replace(/\*$/, '');
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const size = Math.min(limit, pageSize);
      const page = keys.slice(start, start + size);
      const next = start + size < keys.length ? String(start + size) : undefined;
      return { items: page.map((key) => (returnValues ? { key, value: structuredClone(m.get(key)) } : key)), cursor: next };
    },
  };
}

describe('Puter KV backend', () => {
  it('stores one key per record and pages through a whole collection', async () => {
    const kv = fakeKV({ pageSize: 2 });
    const b = createPuterBackend({ kv });
    await b.putRecords('tenants', [1, 2, 3, 4, 5].map((n) => ({ id: `t${n}`, n })));
    expect([...kv.raw.keys()].filter((k) => k.startsWith(`${PREFIX}r:tenants:`))).toHaveLength(5);
    const back = await b.loadCollection('tenants');
    expect(back.map((r) => r.id).sort()).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(kv.calls.list).toBe(3);
  });

  it('keeps ledger months apart so one month loads on its own', async () => {
    const kv = fakeKV({ pageSize: 100 });
    const b = createPuterBackend({ kv });
    await b.putRecords('tx.2026-09', [{ id: 'a', date: '2026-09-30' }]);
    await b.putRecords('tx.2026-10', [{ id: 'b', date: '2026-10-01' }, { id: 'c', date: '2026-10-02' }]);
    expect((await b.loadCollection('tx.2026-10')).map((r) => r.id).sort()).toEqual(['b', 'c']);
    expect((await b.loadCollection('tx.2026-09')).map((r) => r.id)).toEqual(['a']);
  });

  it('does not confuse collections that share a prefix', async () => {
    const kv = fakeKV();
    const b = createPuterBackend({ kv });
    await b.putRecords('team', [{ id: 'm1' }]);
    await b.putRecords('tenants', [{ id: 't1' }]);
    expect((await b.loadCollection('team')).map((r) => r.id)).toEqual(['m1']);
  });

  it('bumps versions atomically and hands out numbers past ones in use', async () => {
    const kv = fakeKV();
    const b = createPuterBackend({ kv });
    expect(await b.bumpVersions(['leases', 'tx.2026-10'])).toEqual({ leases: 1, 'tx.2026-10': 1 });
    expect(await b.bumpVersions(['leases'])).toEqual({ leases: 2, 'tx.2026-10': 1 });
    expect(await b.nextNumber('workOrder')).toBe(1);
    expect(await b.nextNumber('workOrder', 40)).toBe(40);
    expect(await b.nextNumber('workOrder')).toBe(41);
  });

  it('reads ledger versions an earlier build stored as nested paths', async () => {
    const kv = fakeKV();
    kv.raw.set(`${PREFIX}meta`, { leases: 2, tx: { '2026-09': 4, '2026-10': 3 } });
    const b = createPuterBackend({ kv });
    expect(await b.loadMeta()).toEqual({ leases: 2, 'tx.2026-09': 4, 'tx.2026-10': 3 });
    // The next write moves each version up by exactly one.
    expect(await b.bumpVersions(['tx.2026-10'])).toEqual({ leases: 2, 'tx.2026-09': 4, 'tx.2026-10': 4 });
    expect(await b.bumpVersions(['tx.2026-10'])).toMatchObject({ 'tx.2026-10': 5 });
  });

  it('runs the whole store on top of KV across two devices', async () => {
    const kv = fakeKV({ pageSize: 50 });
    const a = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0, timeoutMs: 0 });
    const c = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0, timeoutMs: 0 });
    await a.init();
    await c.init();
    a.put('transactions', { id: 'p1', date: '2026-10-03', kind: 'payment', lines: [] });
    a.put('leases', { id: 'l1', start: '2026-01-01' });
    await a.flush();
    await new Promise((r) => setTimeout(r, 0));
    await a.sync();
    // The writer keeps its ledger entry, and the month is one meta field.
    expect(a.get('transactions', 'p1')).toBeTruthy();
    expect(kv.raw.get(`${PREFIX}meta`)).toMatchObject({ 'tx.2026-10': 1, leases: 1 });
    await c.sync();
    expect(c.get('transactions', 'p1')).toBeTruthy();
    expect(c.get('leases', 'l1')).toBeTruthy();
    // A second sync with nothing new reads only the meta key.
    const before = kv.calls.list;
    await c.sync();
    expect(kv.calls.list).toBe(before);
  });
});
