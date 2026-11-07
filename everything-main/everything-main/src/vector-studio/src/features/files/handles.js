/**
 * File System Access handles (Chromium) kept in IndexedDB so files saved or
 * opened from this computer can be reopened from the recent list.
 * Handles are structured-cloneable; localStorage cannot hold them.
 */
const DB = 'vector-studio-handles';
const STORE = 'handles';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const handleStore = {
  async put(id, handle) {
    try {
      await tx('readwrite', (s) => s.put(handle, id));
      return true;
    } catch {
      return false;
    }
  },
  async get(id) {
    try {
      return (await tx('readonly', (s) => s.get(id))) || null;
    } catch {
      return null;
    }
  },
  async remove(id) {
    try {
      await tx('readwrite', (s) => s.delete(id));
    } catch {
      // Nothing to clean up.
    }
  },
  /** Id of an already stored handle for the same file, so recents do not duplicate. */
  async find(handle) {
    try {
      const db = await openDb();
      try {
        const all = await new Promise((resolve, reject) => {
          const out = [];
          const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return resolve(out);
            out.push([c.key, c.value]);
            c.continue();
          };
          req.onerror = () => reject(req.error);
        });
        for (const [id, h] of all) if (await h.isSameEntry?.(handle)) return id;
      } finally {
        db.close();
      }
    } catch {
      // Fall through.
    }
    return null;
  },
};

/** Ask for permission on a stored handle (needs a user gesture to prompt). */
export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return true;
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

export function fsAccessAvailable() {
  try {
    return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function' && window.self === window.top;
  } catch {
    return false;
  }
}
