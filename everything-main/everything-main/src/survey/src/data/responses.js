/**
 * Responses, as the Analyze screen sees them.
 *
 * They live in the collector worker's KV, one key per response, with keys
 * that sort by submit time. Reading them all on every visit would bill one
 * read per response per visit, so each device keeps a copy in IndexedDB and
 * a sync pages through the worker NEWEST FIRST, stopping once it reaches
 * responses it already holds. The stop point keeps a few minutes of overlap,
 * because edge servers' clocks can disagree slightly about "now".
 *
 * A full re-read happens only when the cache is empty, when the user asks
 * for it, or when the worker's response count disagrees with the cache after
 * an incremental sync (a response deleted on another device, say), at most
 * once per survey per session.
 */
const DB_NAME = 'survey-responses';
const STORE = 'surveys';
const OVERLAP_MS = 5 * 60_000;

function openDb(idb) {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'sid' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Milliseconds encoded in a response key (its first nine base-36 digits). */
export function keyTime(key) {
  return parseInt(String(key).slice(0, 9), 36) || 0;
}

/** A tiny in-memory stand-in when IndexedDB is unavailable (private mode). */
function memoryCache() {
  const m = new Map();
  return {
    get: async (sid) => m.get(sid) || null,
    put: async (rec) => void m.set(rec.sid, rec),
    del: async (sid) => void m.delete(sid),
    drop: async () => m.clear(),
  };
}

function idbCache(idb) {
  let dbp = null;
  // Let another tab delete the database (signing out): close, and reopen on
  // next use. A connection kept open would block the delete, and every open
  // after it, for as long as this tab lives.
  const db = () =>
    (dbp ||= openDb(idb).then((d) => {
      d.onversionchange = () => {
        d.close();
        dbp = null;
      };
      return d;
    }));
  return {
    get: async (sid) => (await tx(await db(), 'readonly', (s) => s.get(sid))) || null,
    put: async (rec) => tx(await db(), 'readwrite', (s) => s.put(rec)),
    del: async (sid) => tx(await db(), 'readwrite', (s) => s.delete(sid)),
    async drop() {
      if (dbp) (await dbp.catch(() => null))?.close();
      dbp = null;
      await new Promise((resolve, reject) => {
        const req = idb.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onblocked = () => resolve();
        req.onerror = () => reject(req.error);
      });
    },
  };
}

export function createResponseStore({ client, idb = globalThis.indexedDB, pageSize = 500 }) {
  let cache = idb ? idbCache(idb) : memoryCache();
  const fullSynced = new Set();
  const inflight = new Map();
  // Keys deleted this session, per survey. A sync that was already under way
  // when they were deleted must not write them back.
  const deleted = new Map();

  function dropDeleted(sid, map) {
    for (const k of deleted.get(sid) || []) map.delete(k);
  }

  async function readCache(sid) {
    try {
      return (await cache.get(sid)) || { sid, items: [], syncedAt: 0 };
    } catch {
      cache = memoryCache();
      return { sid, items: [], syncedAt: 0 };
    }
  }

  async function writeCache(rec) {
    try {
      await cache.put(rec);
    } catch {
      /* cache is a convenience; the worker keeps the data */
    }
  }

  /** Records sorted oldest first. */
  function sorted(map) {
    return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async function fetchAll(sid, stopBefore) {
    const got = [];
    let cursor;
    for (let guard = 0; guard < 10_000; guard++) {
      // Catching up usually means a few new responses, or none: a small
      // first page keeps a poll from reading (and paying for) a full page
      // of responses already cached. The cursor does not depend on it.
      const limit = stopBefore != null && guard === 0 ? Math.min(25, pageSize) : pageSize;
      const page = await client.responsesPage(sid, { limit, cursor });
      const items = page.items || [];
      let reachedKnown = false;
      for (const it of items) {
        if (stopBefore != null && keyTime(it.key) < stopBefore) {
          reachedKnown = true;
          break;
        }
        got.push({ key: it.key, ...it.value });
      }
      cursor = page.cursor;
      if (reachedKnown || !cursor || !items.length) break;
    }
    return got;
  }

  async function doSync(sid, { full = false, expectedCount = null } = {}) {
    const cached = await readCache(sid);
    const map = new Map(cached.items.map((r) => [r.key, r]));
    const newest = cached.items.length ? keyTime(cached.items[cached.items.length - 1].key) : null;
    if (full || newest == null) {
      const all = await fetchAll(sid, null);
      map.clear();
      for (const r of all) map.set(r.key, r);
      dropDeleted(sid, map);
      fullSynced.add(sid);
    } else {
      let added = 0;
      const catchUp = async (from) => {
        for (const r of await fetchAll(sid, from - OVERLAP_MS)) {
          if (!map.has(r.key)) added++;
          map.set(r.key, r);
        }
        dropDeleted(sid, map);
      };
      await catchUp(newest);
      // The collector's count, read after catching up (a function), or as
      // given. A response stored between the two reads can make them
      // disagree for a moment: catch up once more with a fresh count before
      // concluding something was deleted elsewhere and reading everything.
      const count = typeof expectedCount === 'function' ? expectedCount : () => expectedCount;
      let expected = await count();
      if (expected != null && expected !== map.size && !fullSynced.has(sid) && typeof expectedCount === 'function') {
        await catchUp(keyTime(sorted(map).at(-1).key));
        expected = await count();
      }
      if (expected != null && expected !== map.size && !fullSynced.has(sid)) {
        return doSync(sid, { full: true });
      }
      // Responses never change once stored: with none added or dropped the
      // cache already holds this list, and rewriting it (megabytes for a
      // large survey) on every poll would be wasted work.
      if (!added && map.size === cached.items.length) return cached;
    }
    const rec = { sid, items: sorted(map), syncedAt: Date.now() };
    await writeCache(rec);
    return rec;
  }

  return {
    /** Cached responses right away (may be stale). */
    async cached(sid) {
      return (await readCache(sid)).items;
    },
    /** Bring the cache up to date and return every response, oldest first. */
    async sync(sid, opts) {
      if (inflight.has(sid)) return inflight.get(sid);
      const p = doSync(sid, opts)
        .then((r) => r.items)
        .finally(() => inflight.delete(sid));
      inflight.set(sid, p);
      return p;
    },
    async remove(sid, keys) {
      await client.deleteResponses(sid, keys);
      if (!deleted.has(sid)) deleted.set(sid, new Set());
      for (const k of keys) deleted.get(sid).add(k);
      const cached = await readCache(sid);
      const drop = new Set(keys);
      const rec = { ...cached, items: cached.items.filter((r) => !drop.has(r.key)) };
      await writeCache(rec);
      return rec.items;
    },
    /**
     * Keep nothing on this device from now on (signed out in another tab):
     * a sync still under way, or a poll before this tab reloads, would
     * otherwise put respondents' answers back after that tab removed them.
     */
    stop() {
      cache = memoryCache();
    },
    /** Remove every cached response from this device (signing out). */
    async clear() {
      // A sync under way would write its responses back after the delete.
      await Promise.allSettled([...inflight.values()]);
      fullSynced.clear();
      deleted.clear();
      try {
        await cache.drop();
      } catch {
        /* nothing cached */
      }
    },
    async forget(sid) {
      fullSynced.delete(sid);
      try {
        await cache.del(sid);
      } catch {
        /* nothing cached */
      }
    },
  };
}
