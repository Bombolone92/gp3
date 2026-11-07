/**
 * Second review: the downloaded-files cache in IndexedDB (files.js).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tick } from './helpers.js';

async function session() {
  vi.resetModules();
  const { app } = await import('../src/app.js');
  app.user = { username: 'director', uuid: 'u1' };
  app.demo = false;
  return import('../src/files.js');
}

function countEntries() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('childcare-files');
    req.onsuccess = () => {
      const db = req.result;
      const q = db.transaction('blobs').objectStore('blobs').count();
      q.onsuccess = () => {
        db.close();
        resolve(q.result);
      };
      q.onerror = () => reject(q.error);
    };
    req.onerror = () => reject(req.error);
  });
}

const file = (i) => new File([`file ${i}`], `f${i}.txt`, { type: 'text/plain' });

afterEach(() => vi.restoreAllMocks());

describe('file cache', () => {
  it('upgrades a cache written by the previous version and keeps its files', async () => {
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('childcare-files', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('blobs');
      req.onsuccess = () => {
        const db = req.result;
        const t = db.transaction('blobs', 'readwrite');
        t.objectStore('blobs').put({ blob: new Blob(['old']), at: 1 }, 'u1|own|media/2026-09/old.txt');
        t.oncomplete = () => (db.close(), resolve());
      };
      req.onerror = () => reject(req.error);
    });
    const files = await session();
    await files.saveFile(file('new'), { area: 'media', owner: '2026-10' });
    await tick(20);
    expect(await countEntries()).toBe(2);
    const url = await files.fileUrl({ path: 'media/2026-09/old.txt', type: 'text/plain' });
    expect(url).toMatch(/^blob:/);
  });

  it('stays near its cap when every visit caches fewer than 50 files', async () => {
    let n = 0;
    for (let visit = 0; visit < 20; visit++) {
      const files = await session();
      for (let i = 0; i < 49; i++) await files.saveFile(file(n++), { area: 'media', owner: '2026-10' });
      await tick(20);
    }
    await tick(50);
    // 980 files over 20 visits; the cache keeps 600 plus one visit's worth.
    expect(await countEntries()).toBeLessThanOrEqual(600 + 50);
  });

  it('prunes without reading every cached file into memory', async () => {
    const files = await session();
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
    for (let i = 0; i < 120; i++) await files.saveFile(file(10_000 + i), { area: 'media', owner: '2026-11' });
    await tick(200);
    expect(await countEntries()).toBeLessThanOrEqual(600 + 50);
    expect(getAll).not.toHaveBeenCalled();
    expect(cursor).not.toHaveBeenCalled();
  });
});
