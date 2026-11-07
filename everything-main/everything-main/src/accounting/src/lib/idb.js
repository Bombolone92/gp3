/**
 * A small promise wrapper over IndexedDB: one database per signed-in user,
 * with three stores.
 *
 *   records  the last known copy of every KV record, keyed by KV key
 *   outbox   writes made on this device that the cloud has not confirmed
 *   meta     { rev } and similar bookkeeping about the cache itself
 *
 * When IndexedDB is unavailable (private windows in some browsers, or tests)
 * `openCache` returns a memory-only cache with the same interface, so the
 * app still works and simply starts cold every time.
 */

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

class IdbCache {
  constructor(db) {
    this.db = db;
  }
  async getAll(store) {
    const tx = this.db.transaction(store, 'readonly');
    const os = tx.objectStore(store);
    const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
    return keys.map((k, i) => [k, values[i]]);
  }
  async get(store, key) {
    const tx = this.db.transaction(store, 'readonly');
    return req(tx.objectStore(store).get(key));
  }
  /** entries: [[key, value | undefined]] - undefined deletes. */
  async write(store, entries) {
    if (!entries.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const [k, v] of entries) {
      if (v === undefined) os.delete(k);
      else os.put(v, k);
    }
    await txDone(tx);
  }
  /**
   * Read, decide and write each key in one transaction, so another tab's
   * write cannot land in between. fn(key, current) returns the new value,
   * null to delete, or undefined to leave it.
   */
  async modify(store, keys, fn) {
    if (!keys.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const k of keys) {
      const r = os.get(k);
      r.onsuccess = () => {
        const next = fn(k, r.result);
        if (next === null) os.delete(k);
        else if (next !== undefined) os.put(next, k);
      };
    }
    await txDone(tx);
  }
  async clear(store) {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await txDone(tx);
  }
  close() {
    this.db.close();
  }
}

export class MemoryCache {
  constructor() {
    this.stores = { records: new Map(), outbox: new Map(), meta: new Map() };
  }
  async getAll(store) {
    return [...this.stores[store].entries()];
  }
  async get(store, key) {
    return this.stores[store].get(key);
  }
  async write(store, entries) {
    for (const [k, v] of entries) {
      if (v === undefined) this.stores[store].delete(k);
      else this.stores[store].set(k, structuredClone(v));
    }
  }
  async modify(store, keys, fn) {
    const m = this.stores[store];
    for (const k of keys) {
      const cur = m.get(k);
      const next = fn(k, cur === undefined ? undefined : structuredClone(cur));
      if (next === null) m.delete(k);
      else if (next !== undefined) m.set(k, structuredClone(next));
    }
  }
  async clear(store) {
    this.stores[store].clear();
  }
  close() {}
}

export async function openCache(name) {
  const idb = globalThis.indexedDB;
  if (!idb) return new MemoryCache();
  try {
    const open = idb.open(name, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const s of ['records', 'outbox', 'meta']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    const db = await req(open);
    return new IdbCache(db);
  } catch {
    return new MemoryCache();
  }
}

export async function deleteCache(name) {
  const idb = globalThis.indexedDB;
  if (!idb) return;
  try {
    await req(idb.deleteDatabase(name));
  } catch {}
}
