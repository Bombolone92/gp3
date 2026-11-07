import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createIdbCache, clearAllCaches } from '../src/core/cache.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

describe('offline copy', () => {
  it('signing out removes every snapshot on the device', async () => {
    const own = createIdbCache('user:u1');
    const team = createIdbCache('user:u1:team:https://t.puter.work');
    await own.save({ v: 2, collections: { tenants: [{ id: 't' }] } });
    await team.save({ v: 2, collections: {} });
    await clearAllCaches();
    expect(await own.load()).toBeUndefined();
    expect(await team.load()).toBeUndefined();
  });

  it('a store detached from its cache stops writing it', async () => {
    const cache = createIdbCache('user:u2');
    const store = createStore({ backend: createMemoryBackend(), cache, flushDelay: 0, timeoutMs: 0 });
    await store.init();
    store.put('tenants', { id: 'secret' });
    store.detachCache();
    await clearAllCaches();
    await new Promise((r) => setTimeout(r, 700));
    expect(await cache.load()).toBeUndefined();
  });
});

describe('offline copy by collection', () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = async (key) => {
    const store = createStore({ backend: createMemoryBackend(), cache: createIdbCache(key), flushDelay: 0, timeoutMs: 0 });
    await store.init();
    return store;
  };

  it('reopens with everything, and an edit rewrites only what it touched', async () => {
    const a = await open('user:parts');
    a.put('tenants', { id: 't1', firstName: 'Ana' });
    a.put('transactions', { id: 'x9', date: '2026-09-03', kind: 'journal', lines: [] });
    a.put('transactions', { id: 'x10', date: '2026-10-03', kind: 'journal', lines: [] });
    await wait(700);
    const written = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      written.push(key);
      return put.call(this, value, key);
    };
    try {
      a.put('transactions', { id: 'x11', date: '2026-10-04', kind: 'journal', lines: [] });
      await wait(700);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    expect(written.sort()).toEqual(['user:parts', 'user:parts|tx.2026-10']);
    const b = createStore({ backend: { ...createMemoryBackend(), loadMeta: () => new Promise(() => {}) }, cache: createIdbCache('user:parts') });
    b.init();
    await wait(50);
    expect(b.all('transactions').map((t) => t.id).sort()).toEqual(['x10', 'x11', 'x9']);
    expect(b.get('tenants', 't1').firstName).toBe('Ana');
  });

  it('reads a whole snapshot saved by an earlier version', async () => {
    await createIdbCache('user:old').save({ v: 2, collections: { tenants: [{ id: 'old1' }] }, settings: {}, known: {}, synced: true, pending: {} });
    const b = createStore({ backend: { ...createMemoryBackend(), loadMeta: () => new Promise(() => {}) }, cache: createIdbCache('user:old') });
    b.init();
    await wait(50);
    expect(b.get('tenants', 'old1')).toBeTruthy();
  });

  it('forgets a collection that was emptied', async () => {
    const a = await open('user:empty');
    a.put('tasks', { id: 'k1', title: 'Call' });
    await wait(700);
    a.remove('tasks', 'k1');
    await wait(700);
    const cache = createIdbCache('user:empty');
    const snap = await cache.load();
    expect(snap.collections.tasks).toBeUndefined();
  });
});
