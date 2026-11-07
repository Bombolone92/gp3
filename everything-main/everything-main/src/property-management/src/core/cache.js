/**
 * IndexedDB snapshot cache, one entry per signed-in user. Holds the last
 * known data plus writes that have not reached Puter yet.
 */
const DB = 'property-management';
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

/**
 * One cache per user (and team). The snapshot's small parts (settings,
 * versions, unsent changes, the list of collections) live under the user's
 * key, and each collection under `<key>|<collection>`, so a change rewrites
 * only the collections it touched.
 */
export function createIdbCache(userKey) {
  let dbp = null;
  const db = () => (dbp ??= open());
  const partKey = (name) => `${userKey}|${name}`;
  let stored = null; // collection names in the cache now
  return {
    async load() {
      if (typeof indexedDB === 'undefined') return null;
      const meta = await tx(await db(), 'readonly', (s) => s.get(userKey));
      if (meta?.v !== 3) return meta; // a whole snapshot from an earlier version
      const d = await db();
      const collections = await new Promise((resolve, reject) => {
        const t = d.transaction(STORE, 'readonly');
        const out = {};
        for (const name of meta.names || []) {
          const req = t.objectStore(STORE).get(partKey(name));
          req.onsuccess = () => req.result && (out[name] = req.result);
        }
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      stored = new Set(meta.names || []);
      const { names, ...rest } = meta;
      return { ...rest, v: 2, collections };
    },
    /** meta: the snapshot without collections, plus `names`; parts: { name: records } that changed. */
    async saveParts(meta, parts) {
      if (typeof indexedDB === 'undefined') return;
      const d = await db();
      await new Promise((resolve, reject) => {
        const t = d.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        for (const [name, records] of Object.entries(parts)) s.put(records, partKey(name));
        for (const name of stored || []) if (!meta.names.includes(name)) s.delete(partKey(name));
        s.put({ ...meta, v: 3 }, userKey);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
      stored = new Set(meta.names);
    },
    async save(snapshot) {
      if (typeof indexedDB === 'undefined') return;
      await tx(await db(), 'readwrite', (s) => s.put(snapshot, userKey));
    },
    async clear() {
      if (typeof indexedDB === 'undefined') return;
      const d = await db();
      const keys = await tx(d, 'readonly', (s) => s.getAllKeys());
      await tx(d, 'readwrite', (s) => {
        for (const k of keys || []) if (k === userKey || String(k).startsWith(`${userKey}|`)) s.delete(k);
      });
      stored = null;
    },
  };
}

/** Remove every snapshot on this device (signing out). */
export async function clearAllCaches() {
  if (typeof indexedDB === 'undefined') return;
  await tx(await open(), 'readwrite', (s) => s.clear());
}
