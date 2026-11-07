/**
 * Local copies of shared documents on this device: the last confirmed
 * state and the edits not yet confirmed by the server, so work survives a
 * lost connection or a reload and is sent when the connection returns.
 * IndexedDB in browsers; an in-memory store elsewhere (tests).
 */
const DB = 'vector-studio-collab';
const STORE = 'rooms';

function idb() {
  return typeof indexedDB !== 'undefined' && indexedDB ? indexedDB : null;
}

let dbPromise = null;
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = idb().open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function memoryOutbox() {
  const rows = new Map();
  return {
    rows,
    async get(key) {
      return rows.has(key) ? structuredClone(rows.get(key)) : null;
    },
    async put(key, value) {
      rows.set(key, structuredClone(value));
    },
    async delete(key) {
      rows.delete(key);
    },
  };
}

export function indexedOutbox() {
  return {
    get: (key) => tx('readonly', (s) => s.get(key)).then((v) => v ?? null),
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)),
    delete: (key) => tx('readwrite', (s) => s.delete(key)),
  };
}

/** The store for this environment (falls back to memory when IndexedDB is unavailable). */
export function defaultOutbox() {
  if (!idb()) return memoryOutbox();
  const store = indexedOutbox();
  const memory = memoryOutbox();
  // Private browsing can refuse IndexedDB: keep working in memory then.
  const guard = (name) => async (...args) => {
    try {
      return await store[name](...args);
    } catch {
      return memory[name](...args);
    }
  };
  return { get: guard('get'), put: guard('put'), delete: guard('delete') };
}

export const outboxKey = (server, room, user) => `${server}|${room}|${user || ''}`;
