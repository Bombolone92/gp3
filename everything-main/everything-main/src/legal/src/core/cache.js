/**
 * IndexedDB snapshot cache, one entry per signed-in user and firm. Holds the
 * last known data plus writes that have not reached Puter yet.
 */
const DB = 'legal';
const STORE = 'snapshots';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function createIdbCache(userKey) {
  let dbp = null;
  const db = () => (dbp ??= open());
  // A failed open, or a connection the browser closed (Safari drops it, for
  // example), must not stop every later save: open again and retry once.
  async function run(mode, fn) {
    try {
      return await tx(await db(), mode, fn);
    } catch {
      dbp?.then((d) => d.close()).catch(() => {});
      dbp = null;
      return tx(await db(), mode, fn);
    }
  }
  return {
    async load() {
      if (typeof indexedDB === 'undefined') return null;
      return run('readonly', (s) => s.get(userKey));
    },
    async save(snapshot) {
      if (typeof indexedDB === 'undefined') return;
      await run('readwrite', (s) => s.put(snapshot, userKey));
    },
    /** Delete this firm's snapshot (leaving a firm). */
    async clear() {
      if (typeof indexedDB === 'undefined') return;
      await run('readwrite', (s) => s.delete(userKey));
    },
    /** Delete every snapshot in this browser (signing out): other firms this person works in too. */
    async clearAll() {
      if (typeof indexedDB === 'undefined') return;
      await run('readwrite', (s) => s.clear());
    },
  };
}
