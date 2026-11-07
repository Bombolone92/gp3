/**
 * A very small IndexedDB layer: one database, two stores. `outbox` holds
 * unsent messages (with attachment blobs) so they survive a reload; `cache`
 * holds the last page of recently opened conversations and each workspace's
 * bootstrap for offline reading. Every function resolves to null/[] when
 * IndexedDB is unavailable, so callers never have to guard.
 */
const NAME = 'teamchat';
const VERSION = 1;
let dbPromise = null;

/**
 * A read or write the database refused or broke off (an open that failed,
 * a connection closed under the page, a transaction aborted), as against
 * one there is no database for at all (a browser that keeps none for this
 * page, where the callers' memory stands in for it). The two read alike as
 * "nothing here" once, and a read of the outbox that failed this once
 * answered an empty list, which its readers took at its word: every unsent
 * message went off the screen as gone, and nothing sent them.
 */
const FAILED = Symbol('failed');
const settle = (v) => (v === FAILED ? null : v);

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    const opened = new Promise((resolve) => {
      // The browser may close the connection under the page (site data
      // cleared while the app is open, storage reclaimed, another tab
      // upgrading the database), or refuse to open one this once (storage
      // pressure, a passing fault of its own). Kept, the closed connection
      // or the failed open answered nothing to every read and write from
      // then on, and the outbox fell back to this tab's memory for the rest
      // of its life: a message queued offline was gone with a reload. Let
      // go of it; the next call opens anew.
      const forget = () => {
        if (dbPromise === opened) dbPromise = null;
      };
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = forget;
        db.onversionchange = () => {
          db.close();
          forget();
        };
        resolve(db);
      };
      req.onerror = () => {
        forget();
        resolve(FAILED);
      };
      req.onblocked = () => {
        forget();
        resolve(FAILED);
      };
    });
    dbPromise = opened;
    // An open that throws outright (a browser that keeps no databases for
    // this page) is no connection either: the next call tries again.
    opened.catch(() => {
      if (dbPromise === opened) dbPromise = null;
    });
  }
  return dbPromise;
}

/** Run `fn` on the store; the request's result, null for none, FAILED when the database would not (see FAILED). */
function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve) => {
    if (db === FAILED) return resolve(FAILED);
    if (!db) return resolve(null);
    let out = null;
    const t = db.transaction(store, mode); // throws on a connection closed under the page before onclose has said so: FAILED, below
    const req = fn(t.objectStore(store));
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => resolve(out ?? null);
    t.onerror = () => resolve(FAILED);
    t.onabort = () => resolve(FAILED);
  })).catch(() => FAILED);
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)).then(settle),
  /**
   * Every record: `[]` where there is no database for this page (the
   * callers' memory stands in), and null when the read failed this once
   * (see FAILED), so a reader does not take a failure for an empty store.
   */
  all: (store) => tx(store, 'readonly', (s) => s.getAll()).then((v) => (v === FAILED ? null : v || [])),
  /** The keys alone: what a store holds can be counted without reading it. `[]` and null as for all. */
  keys: (store) => tx(store, 'readonly', (s) => s.getAllKeys()).then((v) => (v === FAILED ? null : v || [])),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)).then(settle),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)).then(settle),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()).then(settle),
};
