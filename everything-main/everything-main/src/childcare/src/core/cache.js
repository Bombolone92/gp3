/**
 * IndexedDB snapshot cache, one entry per signed-in user. Holds the last
 * known data plus writes that have not reached Puter yet.
 */
const DB = 'childcare';
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
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function createIdbCache(userKey) {
  let dbp = null;
  const db = () => (dbp ??= open());
  return {
    async load() {
      if (typeof indexedDB === 'undefined') return null;
      return tx(await db(), 'readonly', (s) => s.get(userKey));
    },
    async save(snapshot) {
      if (typeof indexedDB === 'undefined') return;
      await tx(await db(), 'readwrite', (s) => s.put(snapshot, userKey));
    },
    async clear() {
      if (typeof indexedDB === 'undefined') return;
      await tx(await db(), 'readwrite', (s) => s.delete(userKey));
    },
  };
}

/** Remove the snapshot under `userKey` and those under `${userKey}:` (the schools a person joined). */
export async function clearSnapshots(userKey) {
  if (typeof indexedDB === 'undefined') return;
  await tx(await open(), 'readwrite', (s) => {
    s.delete(userKey);
    s.delete(IDBKeyRange.bound(`${userKey}:`, `${userKey}:\uffff`));
  });
}
