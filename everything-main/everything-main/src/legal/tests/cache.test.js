import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { createIdbCache } from '../src/core/cache.js';

const realIdb = globalThis.indexedDB;
afterEach(() => (globalThis.indexedDB = realIdb));

describe('offline snapshot cache', () => {
  it('saves and loads a snapshot per user', async () => {
    const a = createIdbCache('user:a');
    const b = createIdbCache('user:b');
    await a.save({ v: 1, n: 'a' });
    expect(await a.load()).toEqual({ v: 1, n: 'a' });
    expect(await b.load()).toBeUndefined();
  });

  it('tries opening the database again after a failed open', async () => {
    let fail = true;
    globalThis.indexedDB = {
      open: (...args) => {
        if (!fail) return realIdb.open(...args);
        fail = false;
        const req = {};
        setTimeout(() => {
          req.error = new Error('Connection to Indexed Database server lost');
          req.onerror?.();
        });
        return req;
      },
    };
    const cache = createIdbCache('user:retry');
    await cache.save({ v: 1, ok: true });
    expect(await cache.load()).toEqual({ v: 1, ok: true });
  });

  it('reopens the database when the browser closed the connection', async () => {
    const opened = [];
    globalThis.indexedDB = {
      open: (...args) => {
        const req = realIdb.open(...args);
        req.addEventListener('success', () => opened.push(req.result));
        return req;
      },
    };
    const cache = createIdbCache('user:closed');
    await cache.save({ v: 1, n: 1 });
    opened[0].close();
    await cache.save({ v: 1, n: 2 });
    expect(await cache.load()).toEqual({ v: 1, n: 2 });
  });

  it('clears the snapshots of every firm on sign out', async () => {
    const own = createIdbCache('user:u1');
    const joined = createIdbCache('user:u1:team:https://x.puter.work');
    await own.save({ v: 1 });
    await joined.save({ v: 1 });
    await own.clearAll();
    expect(await own.load()).toBeUndefined();
    expect(await joined.load()).toBeUndefined();
  });

  it('keeps the other firms’ snapshots when one firm’s copy is removed (leaving a firm)', async () => {
    const own = createIdbCache('user:u2');
    const joined = createIdbCache('user:u2:team:https://y.puter.work');
    await own.save({ v: 1, n: 'own' });
    await joined.save({ v: 1, n: 'joined' });
    await joined.clear();
    expect(await joined.load()).toBeUndefined();
    expect(await own.load()).toEqual({ v: 1, n: 'own' });
  });
});
