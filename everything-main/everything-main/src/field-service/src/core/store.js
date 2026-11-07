/**
 * The app's single source of truth.
 *
 * Records live in memory as Maps keyed by id. Every change is applied
 * locally first (so the UI never waits on the network), then written to the
 * backend in small batches. A per-collection version counter in the backend
 * tells this device when another device changed something, so a sync only
 * re-reads the collections that actually moved.
 *
 * An optional cache (IndexedDB in the browser) holds a snapshot plus any
 * writes that have not reached the backend yet, so the app opens instantly
 * and survives going offline.
 */
import { newId } from './ids.js';
import { defaultSettings, mergeSettings } from './settings.js';

export const COLLECTIONS = [
  'clients',
  'requests',
  'quotes',
  'jobs',
  'invoices',
  'payments',
  'expenses',
  'timeEntries',
  'events',
  'team',
  'products',
];

const NUMBERED = { quotes: 'quote', jobs: 'job', invoices: 'invoice', requests: 'request' };
// Records sent per request. Each request gets the whole timeout: a large
// restore or delete sent at once could take longer than that however good
// the connection, and would then be retried, whole, forever.
const CHUNK = 100;

export function createStore({ backend, cache = null, now = () => new Date().toISOString(), flushDelay = 250, timeoutMs = 45000 } = {}) {
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
  const listCache = new Map();
  const known = {}; // collection -> backend version this device has
  const pending = { puts: new Map(), dels: new Map(), settings: false }; // key `${coll}\u0000${id}`
  // The settings changes behind pending.settings and inflight.settings. Only
  // these are written over the saved settings, so a change another device
  // made meanwhile to some other setting is kept.
  let unsentSettings = {};
  let sendingSettings = {};
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
    return id ? data[coll].get(id) ?? null : null;
  }

  const pkey = (coll, id) => `${coll}\u0000${id}`;

  function put(coll, record) {
    if (!data[coll]) throw new Error(`Unknown collection: ${coll}`);
    const ts = now();
    const rec = { ...record };
    if (!rec.id) rec.id = newId();
    if (!rec.createdAt) rec.createdAt = ts;
    rec.updatedAt = ts;
    data[coll].set(rec.id, rec);
    pending.dels.delete(pkey(coll, rec.id));
    pending.puts.set(pkey(coll, rec.id), { coll, id: rec.id });
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
    pending.puts.delete(pkey(coll, id));
    pending.dels.set(pkey(coll, id), { coll, id });
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return cur;
  }

  /** Put back a record removed a moment ago (undo). */
  function restore(coll, record) {
    data[coll].set(record.id, record);
    pending.dels.delete(pkey(coll, record.id));
    pending.puts.set(pkey(coll, record.id), { coll, id: record.id });
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return record;
  }

  function saveSettings(changes) {
    state.settings = mergeSettings(state.settings, changes);
    unsentSettings = mergeSettings(unsentSettings, changes);
    pending.settings = true;
    notify(['settings']);
    scheduleFlush();
    return state.settings;
  }

  async function nextNumber(coll) {
    const kind = NUMBERED[coll];
    let localMax = Math.max(0, (Number(state.settings.numbering?.[kind]) || 1) - 1);
    for (const r of data[coll].values()) if (Number(r.number) > localMax) localMax = Number(r.number);
    try {
      // atLeast moves the shared counter past numbers already in use (an
      // import, a configured start, a business that just moved to a team
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
  let closed = false; // signed out or left the business: nothing more is sent or cached
  let retryDelay = 0;
  let syncEpoch = 0; // bumped every time a sync reloads anything
  // Writes that reached the backend, per collection. A read that overlaps
  // one may predate it, and nothing local is left to protect the write.
  const landed = {};
  const markLanded = (coll) => (landed[coll] = (landed[coll] || 0) + 1);

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
    if (flushTimer || closed) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, delay);
  }

  function pendingCount() {
    if (closed) return 0; // given up on, so nothing to wait for
    return pending.puts.size + pending.dels.size + (pending.settings ? 1 : 0) + inflight.puts.size + inflight.dels.size + (inflight.settings ? 1 : 0);
  }

  /** Errors a retry cannot fix (the server rejected the data itself). */
  function isPermanent(err) {
    const s = Number(err?.status) || 0;
    return s >= 400 && s < 500 && ![401, 403, 408, 425, 429].includes(s);
  }

  async function flush() {
    if (closed) return;
    if (flushing) {
      await flushing;
      if (pending.puts.size || pending.dels.size || pending.settings) return flush();
      return;
    }
    if (!pending.puts.size && !pending.dels.size && !pending.settings) return;
    flushing = (async () => {
      for (const [k, v] of pending.puts) inflight.puts.set(k, v);
      for (const [k, v] of pending.dels) inflight.dels.set(k, v);
      inflight.settings = pending.settings;
      const puts = [...pending.puts.values()];
      const dels = [...pending.dels.values()];
      const doSettings = pending.settings;
      sendingSettings = unsentSettings;
      unsentSettings = {};
      pending.puts.clear();
      pending.dels.clear();
      pending.settings = false;
      const epochAtStart = syncEpoch;
      const knownAtStart = { ...known };
      const touched = new Set();
      let rejected = null;
      // A write the server refuses outright is dropped, since retrying would
      // fail the same way and block every later change. Only that write: a
      // refused batch is split until the record at fault is found, and the
      // rest of the changes still go out.
      const send = async (coll, items, write) => {
        try {
          await timed(write(items));
        } catch (err) {
          if (!isPermanent(err)) throw err;
          if (items.length < 2) {
            rejected = err;
            return;
          }
          const half = Math.ceil(items.length / 2);
          await send(coll, items.slice(0, half), write);
          await send(coll, items.slice(half), write);
          return;
        }
        touched.add(coll);
        markLanded(coll);
      };
      try {
        const byColl = new Map();
        for (const p of puts) {
          const rec = get(p.coll, p.id);
          if (!rec) continue;
          if (!byColl.has(p.coll)) byColl.set(p.coll, []);
          byColl.get(p.coll).push(rec);
        }
        for (const [coll, recs] of byColl) for (let i = 0; i < recs.length; i += CHUNK) await send(coll, recs.slice(i, i + CHUNK), (items) => backend.putRecords(coll, items));
        const delsByColl = new Map();
        for (const d of dels) {
          if (!delsByColl.has(d.coll)) delsByColl.set(d.coll, []);
          delsByColl.get(d.coll).push(d.id);
        }
        for (const [coll, ids] of delsByColl) for (let i = 0; i < ids.length; i += CHUNK) await send(coll, ids.slice(i, i + CHUNK), (items) => backend.deleteRecords(coll, items));
        if (doSettings)
          await send('settings', [sendingSettings], async ([changes]) => {
            const saved = mergeSettings(mergeSettings(defaultSettings(), (await backend.loadSettings()) || {}), changes);
            await backend.saveSettings(saved);
            // Redraw only when another device's change came in with it.
            const next = mergeSettings(saved, unsentSettings);
            if (JSON.stringify(next) !== JSON.stringify(state.settings)) {
              state.settings = next;
              notify(['settings']);
            }
          });
        if (touched.size) {
          const names = [...touched];
          const versions = await timed(backend.bumpVersions(names));
          const stale = [];
          for (const n of names) {
            const v = Number(versions?.[n]) || 0;
            // Current only if this device had loaded the collection, nobody
            // else wrote in between (our bump is the only one), and no sync
            // reloaded it while our write was on its way.
            const current = knownAtStart[n] !== undefined && known[n] === knownAtStart[n] && syncEpoch === epochAtStart && knownAtStart[n] + 1 === v;
            if (current) known[n] = v;
            else stale.push(n);
          }
          if (stale.length) queueMicrotask(() => sync({ only: stale }));
        }
        retryDelay = 0;
        setOnline(true);
        if (rejected) {
          console.error('[field-service] changes rejected by the server', rejected);
          state.error = 'Some changes were rejected by the server and could not be saved.';
        }
      } catch (err) {
        if (isPermanent(err)) {
          // Retrying would fail the same way and block every later change.
          console.error('[field-service] changes rejected by the server', err);
          state.error = 'Some changes were rejected by the server and could not be saved.';
          notify(['sync']);
          // Writes that did land still have to reach other devices.
          if (touched.size) backend.bumpVersions([...touched]).catch(() => {});
        } else {
          // Put everything back that has not been superseded meanwhile.
          for (const p of puts) if (!pending.dels.has(pkey(p.coll, p.id)) && !pending.puts.has(pkey(p.coll, p.id))) pending.puts.set(pkey(p.coll, p.id), p);
          for (const d of dels) if (!pending.puts.has(pkey(d.coll, d.id))) pending.dels.set(pkey(d.coll, d.id), d);
          if (doSettings) {
            pending.settings = true;
            unsentSettings = mergeSettings(sendingSettings, unsentSettings);
          }
          handleError(err);
        }
      } finally {
        inflight.puts.clear();
        inflight.dels.clear();
        inflight.settings = false;
        sendingSettings = {};
        flushing = null;
        persistCacheSoon();
        notify(['sync']);
      }
    })();
    await flushing;
    if ((pending.puts.size || pending.dels.size || pending.settings) && state.online && !flushTimer) scheduleFlush();
  }

  function handleError(err) {
    console.warn('[field-service] sync failed', err);
    state.error = err?.message || String(err);
    setOnline(false);
    if (closed) return;
    retryDelay = Math.min(60000, retryDelay ? retryDelay * 2 : 2000);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Until the first successful load, retry the load itself, and the
      // same for a failed sync with nothing to send (flush would do nothing
      // and leave the app showing Offline).
      if (!state.synced || !(pending.puts.size || pending.dels.size || pending.settings)) sync();
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

  let syncing = null;
  let syncingAll = false;
  let queuedOnly = null; // collections asked for while a sync was running
  let queuedAll = null; // a full sync asked for while a partial one was running
  async function sync({ only = null, force = false } = {}) {
    if (syncing) {
      if (only) queuedOnly = new Set([...(queuedOnly || []), ...only]);
      // A partial sync does not cover everything a full one was asked for.
      else if (!syncingAll)
        return (queuedAll ??= syncing.then(() => {
          queuedAll = null;
          return sync({ force });
        }));
      return syncing;
    }
    syncingAll = !only;
    syncing = (async () => {
      state.syncing = true;
      notify(['sync']);
      try {
        const meta = await timed(backend.loadMeta());
        const names = only || [...COLLECTIONS, 'settings'];
        const changedColls = [];
        const reread = [];
        for (const n of names) {
          const remote = Number(meta?.[n]) || 0;
          if (!force && known[n] !== undefined && known[n] === remote) continue;
          const landedBefore = landed[n];
          if (n === 'settings') {
            const s = await timed(backend.loadSettings());
            if (landed[n] !== landedBefore) {
              reread.push(n);
              continue;
            }
            // Changes not saved yet stay on top of what was read.
            state.settings = mergeSettings(mergeSettings(mergeSettings(defaultSettings(), s || {}), sendingSettings), unsentSettings);
          } else {
            const records = await timed(backend.loadCollection(n));
            // A write landed while this read was out, so the read may not
            // include it. Keep what is here and read again.
            if (landed[n] !== landedBefore) {
              reread.push(n);
              continue;
            }
            const m = new Map();
            for (const r of records) m.set(r.id, r);
            // Local writes that have not landed yet win over what we read.
            for (const q of [pending.puts, inflight.puts]) for (const p of q.values()) if (p.coll === n && data[n].has(p.id)) m.set(p.id, data[n].get(p.id));
            for (const q of [pending.dels, inflight.dels]) for (const d of q.values()) if (d.coll === n) m.delete(d.id);
            data[n] = m;
            invalidate(n);
          }
          known[n] = remote;
          syncEpoch++;
          changedColls.push(n);
        }
        state.lastSyncedAt = now();
        if (!only) state.synced = true;
        state.remoteEmpty = !Object.keys(meta || {}).length;
        setOnline(true);
        if (changedColls.length) {
          persistCacheSoon();
          notify(changedColls);
        }
        if (reread.length) queuedOnly = new Set([...(queuedOnly || []), ...reread]);
        if (pending.puts.size || pending.dels.size || pending.settings) {
          // Back online: send now rather than when the retry backoff is up.
          clearTimeout(flushTimer);
          flushTimer = null;
          scheduleFlush(0);
        }
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
        sync({ only: next });
      }
    })();
    return syncing;
  }

  // ---- Cache -------------------------------------------------------------

  let cacheTimer = null;
  let cacheSaving = Promise.resolve();
  function snapshot() {
    const merge = (a, b) => [...new Map([...a, ...b]).values()];
    return {
      v: 1,
      collections: Object.fromEntries(COLLECTIONS.map((c) => [c, all(c)])),
      settings: state.settings,
      known: { ...known },
      synced: state.synced,
      pending: {
        puts: merge(inflight.puts, pending.puts),
        dels: merge(inflight.dels, pending.dels),
        settings: pending.settings || inflight.settings,
        settingsChanges: mergeSettings(sendingSettings, unsentSettings),
      },
    };
  }

  function persistCacheSoon() {
    if (!cache || cacheTimer || closed) return;
    cacheTimer = setTimeout(() => {
      cacheTimer = null;
      cacheSaving = cache.save(snapshot()).catch((err) => console.warn('[field-service] cache write failed', err));
    }, 600);
  }

  /**
   * Stop saving and caching (signing out, leaving a business), so nothing
   * writes the cache again after it is cleared, and unsent changes, already
   * given up on, no longer hold up leaving the page. Resolves once a cache
   * write already under way has finished.
   */
  function close() {
    closed = true;
    clearTimeout(cacheTimer);
    clearTimeout(flushTimer);
    cacheTimer = flushTimer = null;
    return cacheSaving;
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
    for (const p of snap.pending?.puts || []) pending.puts.set(pkey(p.coll, p.id), p);
    for (const d of snap.pending?.dels || []) pending.dels.set(pkey(d.coll, d.id), d);
    if (snap.pending?.settings) {
      pending.settings = true;
      // A cache from before changes were tracked: all of its settings.
      unsentSettings = snap.pending.settingsChanges || snap.settings || {};
    }
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
        if (snap?.v === 1) {
          hydrate(snap);
          fromCache = true;
          state.synced = snap.synced !== false;
        }
      } catch (err) {
        console.warn('[field-service] cache read failed', err);
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

  /** Replace or merge many records at once (import, sample data). */
  function bulkPut(coll, records) {
    const ts = now();
    for (const r of records) {
      const rec = { ...r, id: r.id || newId(), createdAt: r.createdAt || ts, updatedAt: ts };
      data[coll].set(rec.id, rec);
      pending.dels.delete(pkey(coll, rec.id));
      pending.puts.set(pkey(coll, rec.id), { coll, id: rec.id });
    }
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
  }

  function bulkRemove(coll, ids) {
    for (const id of ids) {
      if (!data[coll].delete(id)) continue;
      pending.puts.delete(pkey(coll, id));
      pending.dels.set(pkey(coll, id), { coll, id });
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
    close,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get backendKind() {
      return backend.kind;
    },
  };
}
