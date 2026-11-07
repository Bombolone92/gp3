/**
 * Offline layer: a per-user localStorage mirror of the Puter KV data plus
 * a queue of writes made while unreachable. Modeled on the Accountant
 * app's offline module.
 *
 * The mirror stores the same raw JSON strings Puter holds:
 *   shifts:cache:v1:user               { uuid, username }
 *   shifts:cache:v1:<uuid>:kv:<name>   raw collection JSON ('null' = known-missing)
 *   shifts:cache:v1:<uuid>:dirty       ["employees", "shifts", ...]
 *
 * Every collection is written whole-document, so the queue is just a
 * dirty set: replaying a write sends the current cached value, no
 * operation log needed. Sync is last-writer-wins per collection, which
 * matches how concurrent devices already behave online. All cache access
 * is best-effort: without localStorage the app is simply online-only.
 */

const ROOT = 'shifts:cache:v1';
const META_KEY = `${ROOT}:user`;

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function getMeta() {
  try {
    const meta = JSON.parse(lsGet(META_KEY) || 'null');
    return meta?.uuid ? meta : null;
  } catch {
    return null;
  }
}

const ns = () => {
  const meta = getMeta();
  return meta ? `${ROOT}:${meta.uuid}` : null;
};

function allCacheKeys() {
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ROOT)) keys.push(k);
    }
  } catch {
    /* ignore */
  }
  return keys;
}

function readDirty() {
  const base = ns();
  if (!base) return [];
  try {
    const list = JSON.parse(lsGet(`${base}:dirty`) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeDirty(list) {
  const base = ns();
  return base ? lsSet(`${base}:dirty`, JSON.stringify(list)) : false;
}

export const offline = {
  /** The user this cache belongs to ({ uuid, username }) or null. */
  get user() {
    return getMeta();
  },

  hasCache() {
    return getMeta() !== null;
  },

  matches(user) {
    const meta = getMeta();
    return Boolean(meta && user?.uuid && meta.uuid === user.uuid);
  },

  setUser(user) {
    if (!user?.uuid) return;
    lsSet(META_KEY, JSON.stringify({ uuid: user.uuid, username: user.username || '' }));
  },

  /** Wipe everything (sign-out, or a different user signed in). */
  clearAll() {
    for (const k of allCacheKeys()) lsRemove(k);
  },

  /** Raw cached value, null for known-missing, undefined for cache miss. */
  getKV(collection) {
    const base = ns();
    if (!base) return undefined;
    const raw = lsGet(`${base}:kv:${collection}`);
    if (raw === null) return undefined;
    return raw === 'null' ? null : raw;
  },

  setKV(collection, rawOrNull) {
    const base = ns();
    if (!base) return false;
    return lsSet(`${base}:kv:${collection}`, rawOrNull ?? 'null');
  },

  markDirty(collection) {
    const list = readDirty();
    if (list.includes(collection)) return true;
    list.push(collection);
    return writeDirty(list);
  },

  clearDirty(collection) {
    const list = readDirty();
    const i = list.indexOf(collection);
    if (i !== -1) {
      list.splice(i, 1);
      writeDirty(list);
    }
  },

  dirtyList() {
    return readDirty();
  },

  pendingCount() {
    return readDirty().length;
  },

  /**
   * When the Puter SDK itself couldn't load (offline, uncached), install a
   * stand-in whose network calls all fail. The backend's cache fallbacks
   * and write queue then serve the whole app from local data.
   */
  installStub() {
    const fail = () => Promise.reject(new TypeError('Offline: Puter is unreachable'));
    const meta = getMeta();
    globalThis.puter = {
      auth: {
        isSignedIn: () => true,
        getUser: () => Promise.resolve(meta ? { uuid: meta.uuid, username: meta.username } : null),
        signIn: fail,
        signOut: () => {},
      },
      kv: { get: fail, set: fail, del: fail },
      fs: { read: fail, write: fail, mkdir: fail, readdir: fail, delete: fail },
    };
  },
};

/** A transport-level failure (offline/unreachable) vs a real API error. */
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true; // fetch() rejects with TypeError on network failure
  const msg = String(err?.message ?? err?.error?.message ?? '').toLowerCase();
  return /network|failed to fetch|load failed|offline|unreachable|timed?\s?out|connection/.test(msg);
}
