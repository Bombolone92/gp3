import { describe, it, expect, vi } from 'vitest';
import { createMemoryKV } from '../dev/mock-kv.js';
import { MemoryCache } from '../src/lib/idb.js';
import { Sync, logKey } from '../src/lib/sync.js';
import 'fake-indexeddb/auto';
import { openCache } from '../src/lib/idb.js';

const PREFIXES = ['a', 't'];

/** A Web Locks stand-in: exclusive named locks held until the callback's promise settles. */
function fakeLocks() {
  const held = new Set();
  return {
    async request(name, cb) {
      held.add(name);
      try { return await cb({ name }); } finally { held.delete(name); }
    },
    async query() { return { held: [...held].map((name) => ({ name })) }; },
  };
}

/** A KV whose every call fails like a dropped connection while `net.online` is false. */
function flakyNet(kv) {
  const net = { online: true };
  net.kv = new Proxy(kv, {
    get: (t, p) => (typeof t[p] === 'function'
      ? async (...a) => { if (!net.online) throw new TypeError('Failed to fetch'); return t[p](...a); }
      : t[p]),
  });
  return net;
}

function device(kv, cache = new MemoryCache(), opts = {}) {
  return new Sync({ kv, cache, prefixes: PREFIXES, singles: ['settings'], flushDelay: 0, locks: null, ...opts });
}

describe('sync', () => {
  it('loads everything from the cloud the first time, page by page', async () => {
    const kv = createMemoryKV();
    const items = [];
    for (let i = 0; i < 2500; i++) items.push({ key: `t:${String(i).padStart(5, '0')}`, value: { id: i } });
    for (let i = 0; i < items.length; i += 1000) await kv.set(items.slice(i, i + 1000));
    await kv.set('settings', { company: { name: 'X' } });
    await kv.set('log:000000000001', { keys: [] }); // must not be loaded as a record
    const d = device(kv);
    const { records, fromCache } = await d.start();
    expect(fromCache).toBe(false);
    expect(records.size).toBe(2501);
    expect(records.has('log:000000000001')).toBe(false);
  });

  it('opens from the device cache and costs one read when nothing changed', async () => {
    const kv = createMemoryKV();
    await kv.set('a:1', { name: 'Checking' });
    const cache = new MemoryCache();
    await device(kv, cache).start();
    const d2 = device(kv, cache);
    const { records, fromCache } = await d2.start();
    expect(fromCache).toBe(true);
    expect(records.get('a:1')).toEqual({ name: 'Checking' });
    kv.calls.get = 0; kv.calls.list = 0;
    const { changes, full } = await d2.pull();
    expect(changes).toEqual([]);
    expect(full).toBe(null);
    expect(kv.calls.get).toBe(1);
    expect(kv.calls.list).toBe(0);
  });

  it('batches writes, bumps rev, and logs the keys', async () => {
    const kv = createMemoryKV();
    const d = device(kv);
    await d.start();
    d.put('t:1', { amount: 1 });
    d.put('t:2', { amount: 2 });
    d.put('t:1', { amount: 3 });
    await d.flush();
    expect(await kv.get('t:1')).toEqual({ amount: 3 });
    expect(await kv.get('rev')).toBe(1);
    const log = await kv.get(logKey(1));
    expect(log.keys.sort()).toEqual(['t:1', 't:2']);
    expect(kv.calls.set).toBe(1);
    expect(kv.data.get(logKey(1)).expireAt).toBeGreaterThan(Date.now() / 1000);
    expect(d.pending).toBe(0);
  });

  it('another device picks up only the changed keys', async () => {
    const kv = createMemoryKV();
    const a = device(kv);
    const b = device(kv);
    await a.start();
    a.put('t:1', { v: 1 });
    a.put('t:2', { v: 2 });
    await a.flush();
    await b.start();
    a.put('t:2', { v: 22 });
    a.del('t:1');
    await a.flush();
    const { changes, full } = await b.pull();
    expect(full).toBe(null);
    expect(Object.fromEntries(changes)).toEqual({ 't:1': undefined, 't:2': { v: 22 } });
    expect(b.rev).toBe(2);
  });

  it('skips its own log entries', async () => {
    const kv = createMemoryKV();
    const a = device(kv);
    await a.start();
    a.put('t:1', { v: 1 });
    await a.flush();
    kv.calls.get = 0;
    const { changes } = await a.pull();
    expect(changes).toEqual([]);
  });

  it('does not let a missing log entry block later changes, and rechecks it', async () => {
    let now = 1_000_000;
    const kv = createMemoryKV({ now: () => now });
    const opts = { kv, prefixes: PREFIXES, flushDelay: 0, now: () => now, locks: null };
    const a = new Sync({ ...opts, cache: new MemoryCache() });
    const b = new Sync({ ...opts, cache: new MemoryCache() });
    await a.start();
    await b.start();
    const listsAtStart = kv.calls.list;
    await kv.incr('rev'); // a writer reserved rev 1 and has not written yet
    a.put('t:2', { v: 2 });
    await a.flush(); // rev 2
    const first = await b.pull();
    expect(Object.fromEntries(first.changes)).toEqual({ 't:2': { v: 2 } });
    expect(b.gaps.has(1)).toBe(true);
    // The slow writer lands; the next pull picks it up.
    await kv.set([{ key: 't:1', value: { v: 1 } }, { key: 'log:000000000001', value: { keys: ['t:1'], client: 'slow' } }]);
    const second = await b.pull();
    expect(Object.fromEntries(second.changes)).toEqual({ 't:1': { v: 1 } });
    expect(b.gaps.size).toBe(0);
    // A rev that never gets a log entry is given up on after a while.
    await kv.incr('rev');
    await b.pull();
    now += 11 * 60 * 1000;
    await b.pull();
    expect(b.gaps.size).toBe(0);
    expect(kv.calls.list).toBe(listsAtStart); // never fell back to a full reload
  });

  it('reuses a reserved rev after a failed write', async () => {
    const kv = createMemoryKV();
    const d = device(kv);
    await d.start();
    const realSet = kv.set;
    kv.set = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    d.put('t:1', { v: 1 });
    await expect(d.flush()).rejects.toThrow();
    kv.set = realSet;
    await d.flush();
    expect(await kv.get('rev')).toBe(1);
    expect(await kv.get(logKey(1))).toBeTruthy();
    clearTimeout(d.timer);
  });

  it('does not reuse a reserved rev that other devices may have given up on', async () => {
    let now = 1_000_000;
    const kv = createMemoryKV({ now: () => now });
    const opts = { kv, prefixes: PREFIXES, flushDelay: 0, now: () => now, locks: null };
    const a = new Sync({ ...opts, cache: new MemoryCache() });
    const b = new Sync({ ...opts, cache: new MemoryCache() });
    await a.start();
    await b.start();
    const realSet = kv.set;
    kv.set = vi.fn(async () => { throw Object.assign(new Error('timeout'), { code: 'request_timeout' }); });
    a.put('t:1', { v: 1 });
    await expect(a.flush()).rejects.toThrow();
    clearTimeout(a.timer);
    await b.pull(); // rev 1 is missing
    now += 11 * 60 * 1000; // the connection stays down for a while
    await b.pull(); // b gives up on rev 1
    kv.set = realSet;
    await a.flush();
    const { changes } = await b.pull();
    expect(changes).toEqual([['t:1', { v: 1 }]]);
  });

  it('keeps an edit saved while a full reload is listing the records', async () => {
    const kv = createMemoryKV();
    await kv.set('t:1', { v: 'old' });
    const d = device(kv);
    await d.start();
    d.flushDelay = 100000;
    await kv.set('rev', 1000); // far behind: the next pull reloads everything
    let release;
    const gate = new Promise((r) => { release = r; });
    const realList = kv.list;
    kv.list = async (opts) => {
      if (!opts.pattern.startsWith('t')) return realList(opts);
      const page = await realList(opts);
      await gate;
      return page;
    };
    d.put('t:1', { v: 'edited' });
    const pulling = d.pull();
    await new Promise((r) => setTimeout(r, 10));
    await d.flush(); // lands after the page was read
    release();
    const { full } = await pulling;
    expect(full.get('t:1')).toEqual({ v: 'edited' });
    expect(new Map(await d.cache.getAll('records')).get('t:1')).toEqual({ v: 'edited' });
    kv.list = realList;
    clearTimeout(d.timer);
  });

  it('a record the store refuses does not hold back the rest of the outbox', async () => {
    const kv = createMemoryKV();
    const realSet = kv.set;
    const refuse = Object.assign(new Error('Value too large'), { code: 'field_too_large' });
    kv.set = async (items, ...rest) => {
      if (Array.isArray(items) && items.some((i) => i.key === 't:bad')) { kv.calls.set++; throw refuse; }
      return realSet(items, ...rest);
    };
    const cache = new MemoryCache();
    const d = device(kv, cache);
    await d.start();
    d.flushDelay = 100000;
    const events = [];
    d.on((e, detail) => events.push([e, detail]));
    d.put('t:bad', { huge: true });
    for (let i = 0; i < 150; i++) d.put(`t:${i}`, { v: i });
    kv.calls.set = 0;
    await expect(d.flush()).rejects.toThrow('Value too large');
    clearTimeout(d.timer);
    for (let i = 0; i < 150; i++) expect(await kv.get(`t:${i}`)).toEqual({ v: i });
    expect([...d.outbox.keys()]).toEqual(['t:bad']); // kept, here and on the device
    expect((await cache.getAll('outbox')).map(([k]) => k)).toEqual(['t:bad']);
    expect(d.status).toBe('error');
    expect(events.find(([e]) => e === 'refused')[1].keys).toEqual(['t:bad']);
    expect(kv.calls.set).toBeLessThan(12);
  });

  it('stops quickly when the store refuses everything', async () => {
    const kv = createMemoryKV();
    kv.set = async () => { kv.calls.set++; throw Object.assign(new Error('Forbidden'), { code: 'forbidden' }); };
    const d = device(kv);
    await d.start();
    d.flushDelay = 100000;
    for (let i = 0; i < 300; i++) d.put(`t:${i}`, { v: i });
    kv.calls.set = 0;
    await expect(d.flush()).rejects.toThrow('Forbidden');
    clearTimeout(d.timer);
    expect(kv.calls.set).toBeLessThan(12);
    expect(d.pending).toBe(300);
  });

  it('is caught up only after hearing from the cloud with nothing outstanding', async () => {
    const kv = createMemoryKV();
    await kv.set('a:1', { name: 'Checking' });
    const cache = new MemoryCache();
    await device(kv, cache).start();
    const realGet = kv.get;
    kv.get = async () => { throw new TypeError('Failed to fetch'); };
    const d = device(kv, cache);
    await d.start(); // from the device cache
    expect(d.caughtUp).toBe(false);
    await expect(d.pull()).rejects.toThrow();
    expect(d.caughtUp).toBe(false); // an offline launch never counts
    kv.get = realGet;
    await kv.incr('rev'); // a writer's batch has not landed yet
    await d.pull();
    expect(d.caughtUp).toBe(false);
    await kv.set('log:000000000001', { keys: [], client: 'other' });
    await d.pull();
    expect(d.caughtUp).toBe(true);
  });

  describe('two tabs sharing one device cache', () => {
    async function twoTabs(cache) {
      const kv = createMemoryKV();
      await kv.set('t:1', { amount: 100 });
      const net = flakyNet(kv);
      const locks = fakeLocks();
      const tab = () => device(net.kv, cache, { locks, flushDelay: 100000 });
      const seed = tab();
      await seed.start();
      seed.close();
      return { kv, net, tab };
    }

    for (const [name, makeCache] of [['memory', async () => new MemoryCache()], ['IndexedDB', async () => openCache(`tabs-${Math.random()}`)]]) {
      it(`a tab does not send another open tab's pending edit (${name})`, async () => {
        const cache = await makeCache();
        const { kv, net, tab } = await twoTabs(cache);
        net.online = false;
        const tab1 = tab();
        await tab1.start();
        tab1.put('t:1', { amount: 200 });
        await tab1.flushCache();
        const tab2 = tab();
        await tab2.start(); // opened while tab 1 is still open
        expect(tab2.pending).toBe(0);
        tab1.put('t:1', { amount: 300 }); // the newer edit
        net.online = true;
        await tab1.flush();
        await tab2.flush();
        expect(await kv.get('t:1')).toEqual({ amount: 300 });
        tab1.close(); tab2.close();
      });

      it(`a tab takes over what a closed tab could not send (${name})`, async () => {
        const cache = await makeCache();
        const { kv, net, tab } = await twoTabs(cache);
        const tab2 = tab();
        await tab2.start();
        net.online = false;
        const tab1 = tab();
        await tab1.start();
        tab1.put('t:2', { amount: 5 });
        tab1.del('t:1');
        await tab1.flushCache();
        tab1.close(); // closed while offline
        net.online = true;
        const { changes } = await tab2.pull();
        expect(Object.fromEntries(changes)).toEqual({ 't:2': { amount: 5 }, 't:1': undefined });
        await tab2.flush();
        expect(await kv.get('t:2')).toEqual({ amount: 5 });
        expect(await kv.get('t:1')).toBe(null);
        expect(await cache.getAll('outbox')).toEqual([]);
        // A third tab finds nothing left to take over.
        const tab3 = tab();
        await tab3.start();
        expect(tab3.pending).toBe(0);
        tab2.close(); tab3.close();
      });

      it(`sending an edit does not remove another tab's newer edit of the same record from the device (${name})`, async () => {
        const cache = await makeCache();
        const { kv, tab } = await twoTabs(cache);
        const tab1 = tab();
        const tab2 = tab();
        await tab1.start();
        await tab2.start();
        tab1.put('t:1', { amount: 200 });
        await tab1.flushCache();
        tab2.put('t:1', { amount: 300 });
        await tab2.flushCache();
        await tab1.flush();
        const outbox = await cache.getAll('outbox');
        expect(outbox.map(([k, v]) => [k, v.value])).toEqual([['t:1', { amount: 300 }]]);
        // Tab 2 closes before sending; the next tab still has its edit to send.
        tab2.close();
        const tab3 = tab();
        const { records } = await tab3.start();
        expect(records.get('t:1')).toEqual({ amount: 300 });
        await tab3.flush();
        expect(await kv.get('t:1')).toEqual({ amount: 300 });
        tab1.close(); tab3.close();
      });
    }
  });

  it('a delete never shows up in the log before it happened', async () => {
    const kv = createMemoryKV();
    const a = device(kv);
    const b = device(kv);
    await a.start();
    a.put('t:1', { v: 1 });
    await a.flush();
    await b.start();
    const order = [];
    const realDel = kv.del; const realSet = kv.set;
    kv.del = async (...x) => { order.push('del'); return realDel(...x); };
    kv.set = async (...x) => { order.push('set'); return realSet(...x); };
    a.del('t:1');
    await a.flush();
    expect(order).toEqual(['del', 'set']);
    const { changes } = await b.pull();
    expect(changes).toEqual([['t:1', undefined]]);
  });

  it('rechecks the newest revs after a full load', async () => {
    const kv = createMemoryKV();
    await kv.set('rev', 3);
    const d = device(kv);
    await d.start();
    expect([...d.gaps.keys()]).toEqual([1, 2, 3]);
  });

  it('keeps edits in the outbox while offline and sends them later', async () => {
    const kv = createMemoryKV();
    const cache = new MemoryCache();
    const d = device(kv, cache);
    await d.start();
    const realIncr = kv.incr;
    kv.incr = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    d.put('t:1', { v: 1 });
    await expect(d.flush()).rejects.toThrow();
    expect(d.status).toBe('offline');
    expect((await cache.getAll('outbox')).length).toBe(1);
    // The app restarts while still offline: the edit survives.
    const d2 = device(kv, cache);
    const { records } = await d2.start();
    expect(records.get('t:1')).toEqual({ v: 1 });
    kv.incr = realIncr;
    await d2.flush();
    expect(await kv.get('t:1')).toEqual({ v: 1 });
    expect((await cache.getAll('outbox')).length).toBe(0);
    clearTimeout(d.timer);
  });

  it('a pull that fails while reading the changed records is retried in full', async () => {
    const kv = createMemoryKV();
    const a = device(kv);
    await a.start();
    a.put('t:1', { v: 1 });
    await a.flush();
    const realGet = kv.get;
    const b = device(kv);
    await b.start();
    a.put('t:1', { v: 2 });
    a.put('t:2', { v: 'new' });
    await a.flush();
    kv.get = async (k) => { if (k.startsWith('t:')) throw Object.assign(new Error('rate limited'), { code: 'too_many_requests' }); return realGet(k); };
    await expect(b.pull()).rejects.toThrow();
    kv.get = realGet;
    const { changes } = await b.pull();
    expect(Object.fromEntries(changes)).toEqual({ 't:1': { v: 2 }, 't:2': { v: 'new' } });
  });

  it('still returns pulled changes when the device copy cannot be written', async () => {
    const kv = createMemoryKV();
    const a = device(kv);
    await a.start();
    class FullCache extends MemoryCache {
      async write(store, entries) {
        if (this.full && store === 'records') throw Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
        return super.write(store, entries);
      }
    }
    const cache = new FullCache();
    const b = device(kv, cache);
    await b.start();
    a.put('t:1', { v: 1 });
    await a.flush();
    cache.full = true;
    const { changes } = await b.pull();
    expect(changes).toEqual([['t:1', { v: 1 }]]);
    // The saved rev did not move past what the device copy holds.
    expect((await cache.get('meta', 'state')).rev).toBe(0);
  });

  it('reloads everything when it has been away longer than the log is kept', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const kv = createMemoryKV({ now: () => now });
    const opts = { kv, prefixes: PREFIXES, flushDelay: 0, now: () => now, locks: null };
    const a = new Sync({ ...opts, cache: new MemoryCache() });
    await a.start();
    a.put('t:1', { v: 1 });
    await a.flush();
    const cache = new MemoryCache();
    await new Sync({ ...opts, cache }).start();
    now += 86400e3;
    a.put('t:1', { v: 2 });
    a.put('t:2', { v: 'new' });
    await a.flush();
    now += 31 * 86400e3; // the log entries for those changes have expired
    const b = new Sync({ ...opts, cache });
    await b.start();
    const { full } = await b.pull();
    expect(full?.get('t:1')).toEqual({ v: 2 });
    expect(full?.get('t:2')).toEqual({ v: 'new' });
  });

  it('a device opened often stays incremental even when changes are rare', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const kv = createMemoryKV({ now: () => now });
    const opts = { kv, prefixes: PREFIXES, flushDelay: 0, now: () => now, locks: null };
    const a = new Sync({ ...opts, cache: new MemoryCache() });
    await a.start();
    const cache = new MemoryCache();
    await new Sync({ ...opts, cache }).start();
    for (let day = 0; day < 40; day++) {
      now += 86400e3;
      const b = new Sync({ ...opts, cache });
      await b.start();
      await b.pull(); // nothing new: still one read
    }
    a.put('t:1', { v: 1 });
    await a.flush();
    const b = new Sync({ ...opts, cache });
    await b.start();
    kv.calls.get = 0; kv.calls.list = 0;
    const { changes, full } = await b.pull();
    expect(full).toBe(null);
    expect(changes).toEqual([['t:1', { v: 1 }]]);
    expect(kv.calls.list).toBe(0);
  });

  it('does not return a remote change for a record edited while the pull was finishing', async () => {
    const kv = createMemoryKV();
    const a = device(kv);
    await a.start();
    class SlowCache extends MemoryCache {
      async write(store, entries) {
        await new Promise((r) => setTimeout(r, 5));
        return super.write(store, entries);
      }
    }
    const b = device(kv, new SlowCache());
    await b.start();
    b.flushDelay = 100000;
    a.put('t:1', { v: 'from a' });
    await a.flush();
    const pulling = b.pull();
    await new Promise((r) => setTimeout(r, 2)); // reads done, device cache write in progress
    b.put('t:1', { v: 'from b' });
    const { changes } = await pulling;
    expect(changes).toEqual([]);
    clearTimeout(b.timer);
  });

  it('does not let a remote change overwrite a pending local edit', async () => {
    const kv = createMemoryKV();
    const a = device(kv);
    const b = device(kv);
    await a.start();
    await b.start();
    a.put('t:1', { v: 'from a' });
    await a.flush();
    b.flushDelay = 100000;
    b.put('t:1', { v: 'from b' });
    const { changes } = await b.pull();
    expect(changes).toEqual([]);
    clearTimeout(b.timer);
  });
});
