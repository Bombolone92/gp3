/**
 * The app's single source of truth.
 *
 * Records live in memory as Maps keyed by id. Every change is applied
 * locally first (so the UI never waits on the network), then written to the
 * backend in small batches. Each storage bucket (see schema.js) has a
 * version counter in the backend, so a sync re-reads only the buckets that
 * another device actually changed.
 *
 * An optional cache (IndexedDB in the browser) holds a snapshot plus any
 * writes that have not reached the backend yet, so the app opens instantly
 * and keeps working offline.
 */
import { newId } from './ids.js';
import { defaultSettings, mergeSettings } from './settings.js';
import { COLLECTIONS, NUMBERED, PARTITIONED, bucketOf, collOfBucket, isBucket } from './schema.js';

export { COLLECTIONS };

const SNAPSHOT_VERSION = 1;

export function createStore({ backend, cache = null, now = () => new Date().toISOString(), flushDelay = 250, timeoutMs = 45000, log = 'fleet' } = {}) {
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
  const listCache = new Map();
  const known = {}; // bucket -> backend version this device has loaded
  const writes = {}; // bucket -> writes this device completed (detects loads that raced a write)
  const unbumped = new Set(); // buckets written whose version bump has not reached the backend
  // Pending writes keyed by `${bucket}\u0000${id}` so a record that moved
  // to another month can be put in the new bucket and deleted from the old.
  const pending = { puts: new Map(), dels: new Map(), settings: false };
  const listeners = new Set();

  const state = {
    loaded: false,
    settings: defaultSettings(),
    syncing: false,
    online: true,
    error: null,
    lastSyncedAt: null,
    synced: false, // a full load from the backend has succeeded
    remoteEmpty: false, // the backend has never been written to
  };

  let notifyQueued = false;
  let changed = new Set();
  function notify(colls = []) {
    for (const c of colls) changed.add(c);
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      const c = changed;
      changed = new Set();
      for (const fn of listeners) {
        try {
          fn(c);
        } catch (err) {
          console.error(err);
        }
      }
    });
  }

  function invalidate(coll) {
    listCache.delete(coll);
  }

  function all(coll) {
    let list = listCache.get(coll);
    if (!list) {
      list = [...data[coll].values()];
      listCache.set(coll, list);
    }
    return list;
  }

  function get(coll, id) {
    return id ? (data[coll]?.get(id) ?? null) : null;
  }

  const pkey = (bucket, id) => `${bucket}\u0000${id}`;

  /** Queue a write of `rec`, and a delete from its old bucket if it moved. */
  function queuePut(coll, rec, prev) {
    const bucket = bucketOf(coll, rec);
    if (prev) {
      const old = bucketOf(coll, prev);
      if (old !== bucket) {
        pending.puts.delete(pkey(old, rec.id));
        pending.dels.set(pkey(old, rec.id), { coll, bucket: old, id: rec.id });
      }
    }
    pending.dels.delete(pkey(bucket, rec.id));
    pending.puts.set(pkey(bucket, rec.id), { coll, bucket, id: rec.id });
  }

  function queueDel(coll, rec) {
    const bucket = bucketOf(coll, rec);
    pending.puts.delete(pkey(bucket, rec.id));
    pending.dels.set(pkey(bucket, rec.id), { coll, bucket, id: rec.id });
  }

  function put(coll, record) {
    if (!data[coll]) throw new Error(`Unknown collection: ${coll}`);
    const ts = now();
    const rec = { ...record };
    if (!rec.id) rec.id = newId();
    if (!rec.createdAt) rec.createdAt = ts;
    rec.updatedAt = ts;
    const prev = data[coll].get(rec.id);
    data[coll].set(rec.id, rec);
    queuePut(coll, rec, prev);
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return rec;
  }

  function patch(coll, id, changes) {
    const cur = get(coll, id);
    if (!cur) return null;
    const next = typeof changes === 'function' ? changes(structuredClone(cur)) : { ...cur, ...changes };
    return put(coll, next);
  }

  function remove(coll, id) {
    const cur = get(coll, id);
    if (!cur) return null;
    data[coll].delete(id);
    queueDel(coll, cur);
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return cur;
  }

  /** Put back a record removed a moment ago (undo). */
  function restore(coll, record) {
    data[coll].set(record.id, record);
    queuePut(coll, record, null);
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return record;
  }

  function saveSettings(changes) {
    state.settings = mergeSettings(state.settings, changes);
    pending.settings = true;
    notify(['settings']);
    scheduleFlush();
    return state.settings;
  }

  async function nextNumber(coll) {
    const kind = NUMBERED[coll];
    if (!kind) throw new Error(`${coll} records are not numbered`);
    let localMax = Math.max(0, (state.settings.numbering?.[kind] ?? 1) - 1);
    for (const r of data[coll].values()) if (Number(r.number) > localMax) localMax = Number(r.number);
    try {
      // atLeast moves the shared counter past numbers already in use (an
      // import, a configured start, a fleet that just moved to a team
      // server), so two devices never hand out the same number.
      const n = await timed(backend.nextNumber(kind, localMax + 1));
      return Math.max(Number(n) || 0, localMax + 1);
    } catch {
      return localMax + 1;
    }
  }

  // ---- Writing -----------------------------------------------------------

  // Writes being sent right now. They count as local changes for a sync
  // that overlaps them and for the offline cache, until they land.
  const inflight = { puts: new Map(), dels: new Map(), settings: false };
  let flushTimer = null;
  let flushing = null;
  let retryDelay = 0;
  let syncEpoch = 0; // bumped every time a sync reloads anything

  function timed(promise) {
    if (!timeoutMs) return promise;
    let t;
    return Promise.race([
      promise,
      new Promise((_, reject) => (t = setTimeout(() => reject(Object.assign(new Error('The request timed out'), { code: 'timeout' })), timeoutMs))),
    ]).finally(() => clearTimeout(t));
  }

  function scheduleFlush(delay = flushDelay) {
    persistCacheSoon();
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, delay);
  }

  function pendingCount() {
    return pending.puts.size + pending.dels.size + (pending.settings ? 1 : 0) + inflight.puts.size + inflight.dels.size + (inflight.settings ? 1 : 0);
  }

  /** Errors a retry cannot fix (the server rejected the data itself). */
  function isPermanent(err) {
    const s = Number(err?.status) || 0;
    return s >= 400 && s < 500 && ![401, 408, 425, 429].includes(s);
  }

  const hasPending = () => pending.puts.size || pending.dels.size || pending.settings || unbumped.size;

  async function flush() {
    if (flushing) {
      await flushing;
      if (hasPending()) return flush();
      return;
    }
    if (!hasPending()) return;
    flushing = (async () => {
      try {
        await flushOnce();
      } finally {
        inflight.puts.clear();
        inflight.dels.clear();
        inflight.settings = false;
        flushing = null;
        persistCacheSoon();
        notify(['sync']);
      }
    })();
    await flushing;
    if (hasPending() && state.online && !flushTimer) scheduleFlush();
  }

  async function flushOnce() {
    {
      for (const [k, v] of pending.puts) inflight.puts.set(k, v);
      for (const [k, v] of pending.dels) inflight.dels.set(k, v);
      inflight.settings = pending.settings;
      const puts = [...pending.puts.values()];
      const dels = [...pending.dels.values()];
      const doSettings = pending.settings;
      pending.puts.clear();
      pending.dels.clear();
      pending.settings = false;
      const epochAtStart = syncEpoch;
      const knownAtStart = { ...known };
      // Each bucket is written on its own. A bucket the server rejects
      // (permissions, bad data) is dropped and reloaded; it never blocks
      // the others. A network failure stops the flush and the rest is
      // retried later. Whatever was written is always version-bumped, so
      // other devices see it even if a later step fails.
      const written = new Set();
      const rejected = new Set();
      const sent = new Set(); // pkeys that reached a final state
      let transient = null;
      let permanent = null;
      const attempt = async (bucket, keys, fn) => {
        if (transient) return;
        try {
          await timed(fn());
          written.add(bucket);
          writes[bucket] = (writes[bucket] || 0) + 1;
          for (const k of keys) sent.add(k);
        } catch (err) {
          if (isPermanent(err)) {
            permanent = err;
            rejected.add(bucket);
            for (const k of keys) sent.add(k);
          } else transient = err;
        }
      };
      const byBucket = new Map();
      for (const p of puts) {
        const rec = get(p.coll, p.id);
        // Skip if it was deleted, or moved again since it was queued.
        if (!rec || bucketOf(p.coll, rec) !== p.bucket) {
          sent.add(pkey(p.bucket, p.id));
          continue;
        }
        if (!byBucket.has(p.bucket)) byBucket.set(p.bucket, { recs: [], keys: [] });
        byBucket.get(p.bucket).recs.push(rec);
        byBucket.get(p.bucket).keys.push(pkey(p.bucket, p.id));
      }
      for (const [bucket, { recs, keys }] of byBucket) await attempt(bucket, keys, () => backend.putRecords(bucket, recs));
      const delsByBucket = new Map();
      for (const d of dels) {
        if (!delsByBucket.has(d.bucket)) delsByBucket.set(d.bucket, { ids: [], keys: [] });
        delsByBucket.get(d.bucket).ids.push(d.id);
        delsByBucket.get(d.bucket).keys.push(pkey(d.bucket, d.id));
      }
      for (const [bucket, { ids, keys }] of delsByBucket) await attempt(bucket, keys, () => backend.deleteRecords(bucket, ids));
      let settingsDone = !doSettings;
      if (doSettings) {
        await attempt('settings', [], () => backend.saveSettings(state.settings));
        settingsDone = written.has('settings') || rejected.has('settings');
      }
      // Bump everything written now, plus bumps an earlier flush could not send.
      for (const b of written) unbumped.add(b);
      if (unbumped.size) {
        const names = [...unbumped];
        try {
          const versions = await timed(backend.bumpVersions(names));
          for (const n of names) unbumped.delete(n);
          const stale = [];
          for (const n of names) {
            const v = Number(versions?.[n]) || 0;
            // Current only if this device knew the bucket's version (or the
            // bucket is brand new), nobody else wrote in between (our bump is
            // the only one), and no sync reloaded anything meanwhile.
            const base = knownAtStart[n] ?? (state.synced ? 0 : undefined);
            const current = written.has(n) && base !== undefined && (known[n] ?? 0) === base && syncEpoch === epochAtStart && base + 1 === v;
            if (current) known[n] = v;
            else stale.push(n);
          }
          if (stale.length) queueMicrotask(() => sync({ only: stale }));
        } catch (err) {
          // A rejected bump cannot succeed later; dropping it only delays
          // other devices until the next write. Anything else is retried.
          if (isPermanent(err)) for (const n of names) unbumped.delete(n);
          else if (!transient) transient = err;
        }
      }
      if (rejected.size) {
        console.error(`[${log}] changes rejected by the server`, permanent);
        state.error = permanent?.status === 403 ? 'You do not have permission to make some of these changes.' : 'Some changes were rejected by the server and could not be saved.';
        notify(['sync']);
        // Bring back what the server really has for those buckets.
        const only = [...rejected];
        queueMicrotask(() => sync({ only, force: true }));
      }
      if (transient) {
        // Put back everything not sent that has not been superseded meanwhile.
        for (const p of puts) {
          const k = pkey(p.bucket, p.id);
          if (!sent.has(k) && !pending.dels.has(k) && !pending.puts.has(k)) pending.puts.set(k, p);
        }
        for (const d of dels) {
          const k = pkey(d.bucket, d.id);
          if (!sent.has(k) && !pending.puts.has(k)) pending.dels.set(k, d);
        }
        if (!settingsDone) pending.settings = true;
        handleError(transient);
      } else {
        retryDelay = 0;
        if (!rejected.size) {
          // Everything saved: an earlier rejection no longer applies.
          if (state.online && state.error) {
            state.error = null;
            notify(['sync']);
          }
          setOnline(true);
        }
      }
    }
  }

  function handleError(err) {
    console.warn(`[${log}] sync failed`, err);
    state.error = err?.message || String(err);
    setOnline(false);
    retryDelay = Math.min(60000, retryDelay ? retryDelay * 2 : 2000);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Until the first successful load, retry the load itself.
      if (!state.synced) sync();
      else flush();
    }, retryDelay);
  }

  function setOnline(v) {
    if (state.online === v) return;
    state.online = v;
    if (v) state.error = null;
    notify(['sync']);
  }

  // ---- Reading -----------------------------------------------------------

  /** Ids with a local version that must win over what the backend has. */
  function localIds(coll) {
    const ids = new Set();
    for (const q of [pending.puts, inflight.puts]) for (const p of q.values()) if (p.coll === coll) ids.add(p.id);
    return ids;
  }

  function localDels(bucket) {
    const ids = new Set();
    for (const q of [pending.dels, inflight.dels]) for (const d of q.values()) if (d.bucket === bucket) ids.add(d.id);
    return ids;
  }

  /** Replace what this device holds for one bucket with fresh records. */
  function applyBucket(bucket, records) {
    const coll = collOfBucket(bucket);
    const m = data[coll];
    const mine = localIds(coll);
    const deleted = localDels(bucket);
    const partitioned = Boolean(PARTITIONED[coll]);
    // Drop what this bucket used to hold, except local changes.
    if (partitioned) {
      for (const [id, r] of m) if (!mine.has(id) && bucketOf(coll, r) === bucket) m.delete(id);
    } else {
      for (const id of [...m.keys()]) if (!mine.has(id)) m.delete(id);
    }
    for (const r of records) {
      if (!r || typeof r !== 'object' || !r.id) continue;
      if (mine.has(r.id) || deleted.has(r.id)) continue;
      // A record another device just moved between months can briefly be
      // in two buckets; keep the newer copy.
      const cur = m.get(r.id);
      if (cur && String(cur.updatedAt || '') > String(r.updatedAt || '')) continue;
      m.set(r.id, r);
    }
    invalidate(coll);
    return coll;
  }

  let syncing = null;
  let queuedOnly = null; // buckets asked for while a sync was running
  async function sync({ only = null, force = false } = {}) {
    if (syncing) {
      if (only) queuedOnly = new Set([...(queuedOnly || []), ...only]);
      else queuedOnly = new Set([...(queuedOnly || []), '*']);
      return syncing;
    }
    syncing = (async () => {
      state.syncing = true;
      notify(['sync']);
      try {
        const meta = (await timed(backend.loadMeta())) || {};
        let names;
        if (only) names = only;
        else {
          names = new Set(['settings']);
          for (const c of COLLECTIONS) if (!PARTITIONED[c]) names.add(c);
          for (const b of Object.keys(meta)) if (isBucket(b)) names.add(b);
          // Buckets this device holds that the backend no longer lists.
          for (const b of Object.keys(known)) if (b !== 'settings' && isBucket(b)) names.add(b);
          names = [...names];
        }
        const changedColls = new Set();
        const raced = [];
        for (const n of names) {
          const remote = Number(meta[n]) || 0;
          if (!force && known[n] !== undefined && known[n] === remote) continue;
          if (n !== 'settings' && !isBucket(n)) continue;
          // A write that finishes while this read is out may not be in what
          // comes back, and nothing local is left to protect it. Load again.
          const writesAtStart = writes[n] || 0;
          if (n === 'settings') {
            const s = await timed(backend.loadSettings());
            if ((writes[n] || 0) !== writesAtStart) {
              raced.push(n);
              continue;
            }
            if (!pending.settings && !inflight.settings) state.settings = mergeSettings(defaultSettings(), s || {});
            changedColls.add('settings');
          } else {
            // A bucket the backend has never written holds nothing yet.
            const records = remote || known[n] !== undefined ? await timed(backend.loadBucket(n)) : [];
            if ((writes[n] || 0) !== writesAtStart) {
              raced.push(n);
              continue;
            }
            changedColls.add(applyBucket(n, records));
          }
          known[n] = remote;
          syncEpoch++;
        }
        state.lastSyncedAt = now();
        if (!only) state.synced = true;
        state.remoteEmpty = !Object.keys(meta).length;
        const wasOffline = !state.online;
        setOnline(true);
        if (changedColls.size) {
          persistCacheSoon();
          notify([...changedColls]);
        }
        if (wasOffline) {
          // The connection is back: send waiting changes now instead of
          // sitting out the retry backoff.
          retryDelay = 0;
          if (hasPending() && state.synced) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
        }
        if (hasPending()) scheduleFlush(0);
        if (raced.length) queuedOnly = new Set([...(queuedOnly || []), ...raced]);
      } catch (err) {
        handleError(err);
      } finally {
        state.syncing = false;
        syncing = null;
        notify(['sync']);
      }
      if (queuedOnly) {
        const next = [...queuedOnly];
        queuedOnly = null;
        sync(next.includes('*') ? {} : { only: next });
      }
    })();
    return syncing;
  }

  // ---- Cache -------------------------------------------------------------

  let cacheTimer = null;
  function snapshot() {
    const merge = (a, b) => [...new Map([...a, ...b]).values()];
    return {
      v: SNAPSHOT_VERSION,
      collections: Object.fromEntries(COLLECTIONS.map((c) => [c, all(c)])),
      settings: state.settings,
      known: { ...known },
      unbumped: [...unbumped],
      synced: state.synced,
      pending: {
        puts: merge(inflight.puts, pending.puts),
        dels: merge(inflight.dels, pending.dels),
        settings: pending.settings || inflight.settings,
      },
    };
  }

  function persistCacheSoon() {
    if (!cache || cacheTimer) return;
    cacheTimer = setTimeout(() => {
      cacheTimer = null;
      cache.save(snapshot()).catch((err) => console.warn(`[${log}] cache write failed`, err));
    }, 600);
  }

  /** Write the cache now, for a page being hidden or closed (timers stop with it). */
  function persistCache() {
    if (!cache) return Promise.resolve();
    clearTimeout(cacheTimer);
    cacheTimer = null;
    return cache.save(snapshot()).catch((err) => console.warn(`[${log}] cache write failed`, err));
  }

  /** Stop writing the cache, for signing out (its contents are being removed). */
  function detachCache() {
    clearTimeout(cacheTimer);
    cacheTimer = null;
    cache = null;
  }

  function hydrate(snap) {
    for (const c of COLLECTIONS) {
      const m = new Map();
      for (const r of snap.collections?.[c] || []) m.set(r.id, r);
      data[c] = m;
      invalidate(c);
    }
    state.settings = mergeSettings(defaultSettings(), snap.settings || {});
    // A cache saved before the first successful load knows nothing about
    // the backend's versions yet.
    if (snap.synced !== false) Object.assign(known, snap.known || {});
    for (const b of snap.unbumped || []) if (b === 'settings' || isBucket(b)) unbumped.add(b);
    for (const p of snap.pending?.puts || []) if (p.bucket) pending.puts.set(pkey(p.bucket, p.id), p);
    for (const d of snap.pending?.dels || []) if (d.bucket) pending.dels.set(pkey(d.bucket, d.id), d);
    if (snap.pending?.settings) pending.settings = true;
  }

  /**
   * Opens the store: cached snapshot first (instant), then the backend.
   * Resolves once there is something to show. state.synced turns true after
   * the first complete load from the backend; until then an empty store
   * means "not loaded yet", not "no data".
   */
  async function init() {
    let fromCache = false;
    if (cache) {
      try {
        const snap = await cache.load();
        if (snap?.v === SNAPSHOT_VERSION) {
          hydrate(snap);
          fromCache = true;
          state.synced = snap.synced !== false;
        }
      } catch (err) {
        console.warn(`[${log}] cache read failed`, err);
      }
    }
    if (fromCache) {
      state.loaded = true;
      notify(COLLECTIONS);
      sync();
    } else {
      await sync();
      state.loaded = true;
      notify(COLLECTIONS);
    }
  }

  /** Add or replace many records at once (import, sample data). */
  function bulkPut(coll, records) {
    const ts = now();
    const out = [];
    for (const r of records) {
      const rec = { ...r, id: r.id || newId(), createdAt: r.createdAt || ts, updatedAt: ts };
      const prev = data[coll].get(rec.id);
      data[coll].set(rec.id, rec);
      queuePut(coll, rec, prev);
      out.push(rec);
    }
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return out;
  }

  function bulkRemove(coll, ids) {
    for (const id of ids) {
      const cur = data[coll].get(id);
      if (!cur) continue;
      data[coll].delete(id);
      queueDel(coll, cur);
    }
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
  }

  return {
    state,
    all,
    get,
    put,
    patch,
    remove,
    restore,
    bulkPut,
    bulkRemove,
    saveSettings,
    nextNumber,
    init,
    sync,
    flush,
    pendingCount,
    snapshot,
    persistCache,
    detachCache,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get backendKind() {
      return backend.kind;
    },
  };
}
