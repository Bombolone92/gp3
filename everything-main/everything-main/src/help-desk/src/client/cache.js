/**
 * IndexedDB cache of each desk's records, so the app opens instantly and
 * only asks the server for what changed since last time. Everything here is
 * best effort: if IndexedDB is unavailable (private mode, quota), the app
 * simply loads from the server each time.
 */
const DB_NAME = 'help-desk';
const VERSION = 1;

let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function open() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ||= new Promise((resolve) => {
    let r;
    try {
      r = indexedDB.open(DB_NAME, VERSION);
    } catch {
      resolve(null);
      return;
    }
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('records')) {
        const s = db.createObjectStore('records', { keyPath: ['ref', 'kind', 'id'] });
        s.createIndex('byKind', ['ref', 'kind']);
      }
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'ref' });
    };
    r.onsuccess = () => {
      const db = r.result;
      // Let another tab upgrade or delete the database instead of blocking it.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
    // An open can wait indefinitely behind another tab's pending delete or
    // upgrade; the cache is optional, so carry on without it.
    setTimeout(() => resolve(null), 2500);
  });
  return dbPromise;
}

export async function loadDesk(ref) {
  const db = await open();
  if (!db) return null;
  try {
    const tx = db.transaction(['records', 'state'], 'readonly');
    const state = await req(tx.objectStore('state').get(ref));
    if (!state) return null;
    const idx = tx.objectStore('records').index('byKind');
    const out = { state };
    for (const kind of ['t', 'u', 'o', 'a']) {
      const rows = await req(idx.getAll(IDBKeyRange.only([ref, kind])));
      out[kind] = rows.map((r) => r.v);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Write changed records and the sync state in one transaction. Resolves to
 * false when the write failed (storage full, blocked), so nothing was saved.
 */
export async function saveDesk(ref, { puts = [], dels = [], state = null }) {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(['records', 'state'], 'readwrite');
    const records = tx.objectStore('records');
    for (const { kind, id, v } of puts) records.put({ ref, kind, id, v });
    for (const { kind, id } of dels) records.delete([ref, kind, id]);
    if (state) tx.objectStore('state').put({ ...state, ref });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch (e) {
    console.warn('Could not update the offline cache', e);
    return false;
  }
}

/** Remove every desk's cached records from this browser (on sign out). */
export async function clearAll() {
  const db = await open();
  db?.close();
  dbPromise = null;
  if (typeof indexedDB === 'undefined') return;
  await new Promise((resolve) => {
    try {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Browser storage that holds desk content (as opposed to preferences such as
// the theme): open ticket tabs, notifications, searches, the mailbox
// position and article drafts.
const CONTENT_KEYS = ['help-desk:tabs', 'help-desk:notifications', 'help-desk:recent-searches', 'help-desk:mailbox', 'help-desk:kb-draft'];

/** Forget everything of the agent's desks this browser keeps (on sign out). */
export async function forgetLocalData() {
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      for (const key of Object.keys(store)) {
        if (CONTENT_KEYS.some((p) => key.startsWith(p))) store.removeItem(key);
      }
    } catch {
      /* storage blocked */
    }
  }
  await clearAll();
}

export async function clearDesk(ref) {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(['records', 'state'], 'readwrite');
    const idx = tx.objectStore('records').index('byKind');
    for (const kind of ['t', 'u', 'o', 'a']) {
      const keys = await req(idx.getAllKeys(IDBKeyRange.only([ref, kind])));
      for (const k of keys) tx.objectStore('records').delete(k);
    }
    tx.objectStore('state').delete(ref);
  } catch {
    /* ignore */
  }
}
