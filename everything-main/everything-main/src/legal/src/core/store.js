/**
 * The app's single source of truth.
 *
 * Records live in memory as Maps keyed by id. Every change applies locally
 * first (the interface never waits on the network) and is then written to the
 * backend in small batches. A per-collection version counter in the backend
 * tells this device when another device or teammate changed something, so a
 * sync re-reads only the collections that actually moved.
 *
 * An optional cache (IndexedDB in the browser) holds a snapshot plus writes
 * that have not reached the backend yet, so the app opens instantly and keeps
 * working offline.
 */
import { newId } from './ids.js';
import { defaultSettings, mergeSettings } from './settings.js';

export const COLLECTIONS = [
  'matters',
  'contacts',
  'activities',
  'tasks',
  'events',
  'bills',
  'payments',
  'transactions',
  'accounts',
  'communications',
  'notes',
  'documents',
  'users',
  'taskLists',
  'templates',
];

const NUMBERED = { matters: 'matter', bills: 'bill' };

// Records sent per flush. Every request then finishes well within the
// timeout however large an import or a "delete everything" is, and each
// round that lands is kept even if a later one fails. Writes go out 100 to
// a request, deletions one at a time, so a round holds more writes; each
// round also bumps versions once, so small rounds would double the requests.
const FLUSH_MAX_PUTS = 500;
const FLUSH_MAX_DELS = 100;

// Error codes Puter KV uses when it refuses the data itself (a value or key
// over the size limit, a malformed request), which sending again cannot fix.
const REJECTED_CODES = new Set(['value_too_large', 'key_too_large', 'key_undefined', 'items_required', 'invalid_item', 'bad_request']);

export function createStore({ backend, cache = null, now = () => new Date().toISOString(), flushDelay = 250, timeoutMs = 45000, log = 'legal' } = {}) {
  const data = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
  const listCache = new Map();
  const known = {}; // collection -> backend version this device has seen
  // settings: false, or the settings changes not sent yet. Settings are one
  // item, so keeping the changes (not just a flag) lets them be applied on top
  // of a colleague's newer settings instead of replacing them.
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

  const invalidate = (coll) => listCache.delete(coll);

  function all(coll) {
    let list = listCache.get(coll);
    if (!list) {
      list = [...data[coll].values()];
      listCache.set(coll, list);
    }
    return list;
  }

  function get(coll, id) {
    return id ? (data[coll].get(id) ?? null) : null;
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
    noteChange();
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
    noteChange();
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
    noteChange();
    scheduleFlush();
    return record;
  }

  function saveSettings(changes) {
    state.settings = mergeSettings(state.settings, changes);
    pending.settings = mergeSettings(pending.settings || {}, changes);
    notify(['settings']);
    noteChange();
    scheduleFlush();
    return state.settings;
  }

  async function nextNumber(coll) {
    const kind = NUMBERED[coll];
    let localMax = Math.max(0, (state.settings.numbering?.[kind] ?? 1) - 1);
    for (const r of data[coll].values()) if (Number(r.number) > localMax) localMax = Number(r.number);
    try {
      // atLeast moves the shared counter past numbers already in use (an
      // import, a configured start, a firm that just moved to a team
      // server), so two devices never hand out the same number.
      const n = await timed(backend.nextNumber(kind, localMax + 1));
      return Math.max(Number(n) || 0, localMax + 1);
    } catch {
      return localMax + 1;
    }
  }

  // ---- Writing -----------------------------------------------------------

  // Writes being sent right now. They count as local changes for a sync that
  // overlaps them and for the offline cache, until they land.
  const inflight = { puts: new Map(), dels: new Map(), settings: false };
  let flushTimer = null;
  let flushing = null;
  let retryDelay = 0;
  let syncEpoch = 0; // bumped every time a sync reloads anything
  const landed = {}; // collection -> count of local writes that reached the backend

  function timed(promise) {
    if (!timeoutMs) return promise;
    let t;
    return Promise.race([promise, new Promise((_, reject) => (t = setTimeout(() => reject(Object.assign(new Error('The request timed out'), { code: 'timeout' })), timeoutMs)))]).finally(() =>
      clearTimeout(t),
    );
  }

  function scheduleFlush(delay = flushDelay) {
    persistCacheSoon();
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, delay);
  }

  /** Settings changes made on this device that have not landed yet. */
  const localSettingsChanges = () => mergeSettings(inflight.settings || {}, pending.settings || {});

  /** Settings as read from the backend, with this device's unsent changes on top. */
  const withLocalSettings = (remote) => mergeSettings(mergeSettings(defaultSettings(), remote || {}), localSettingsChanges());

  function pendingCount() {
    return pending.puts.size + pending.dels.size + (pending.settings ? 1 : 0) + inflight.puts.size + inflight.dels.size + (inflight.settings ? 1 : 0);
  }

  // After the server refused some changes, the error stays up until a change
  // made since then has been saved, so it is seen but does not linger.
  let changedSinceError = false;
  const noteChange = () => {
    if (state.error) changedSinceError = true;
  };

  /** Errors a retry cannot fix (the server rejected the data itself). */
  function isPermanent(err) {
    const s = Number(err?.status) || 0;
    if (s) return s >= 400 && s < 500 && ![401, 403, 408, 425, 429].includes(s);
    // Puter KV refuses bad data with a plain { message, code } and no status.
    return REJECTED_CODES.has(err?.code);
  }

  async function flush() {
    if (flushing) {
      await flushing;
      if (pending.puts.size || pending.dels.size || pending.settings) return flush();
      return;
    }
    if (!pending.puts.size && !pending.dels.size && !pending.settings) return;
    let more = false;
    flushing = (async () => {
      const take = (from, to, room) => {
        const out = [];
        for (const [k, v] of from) {
          if (room <= 0) break;
          room--;
          to.set(k, v);
          out.push(v);
        }
        for (const v of out) from.delete(pkey(v.coll, v.id));
        return out;
      };
      const puts = take(pending.puts, inflight.puts, FLUSH_MAX_PUTS);
      const dels = take(pending.dels, inflight.dels, FLUSH_MAX_DELS);
      more = pending.puts.size + pending.dels.size > 0;
      const doSettings = pending.settings;
      inflight.settings = doSettings;
      pending.settings = false;
      const epochAtStart = syncEpoch;
      const knownAtStart = { ...known };
      const touched = new Set();
      let current = null; // the request that failed: 'put:<collection>', 'del:<collection>', or 'settings'
      try {
        const byColl = new Map();
        for (const p of puts) {
          const rec = get(p.coll, p.id);
          if (!rec) continue;
          if (!byColl.has(p.coll)) byColl.set(p.coll, []);
          byColl.get(p.coll).push(rec);
        }
        for (const [coll, recs] of byColl) {
          current = `put:${coll}`;
          await timed(backend.putRecords(coll, recs));
          touched.add(coll);
          landed[coll] = (landed[coll] || 0) + 1;
        }
        const delsByColl = new Map();
        for (const d of dels) {
          if (!delsByColl.has(d.coll)) delsByColl.set(d.coll, []);
          delsByColl.get(d.coll).push(d.id);
        }
        for (const [coll, ids] of delsByColl) {
          current = `del:${coll}`;
          await timed(backend.deleteRecords(coll, ids));
          touched.add(coll);
          landed[coll] = (landed[coll] || 0) + 1;
        }
        if (doSettings) {
          current = 'settings';
          // When someone else saved settings since this device last read
          // them, start from theirs so this save does not undo their change.
          const meta = await timed(backend.loadMeta());
          if (known.settings === undefined || (Number(meta?.settings) || 0) !== known.settings) {
            state.settings = withLocalSettings(await timed(backend.loadSettings()));
            notify(['settings']);
          }
          await timed(backend.saveSettings(state.settings));
          touched.add('settings');
          landed.settings = (landed.settings || 0) + 1;
        }
        current = null;
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
        if (state.error && changedSinceError && !pending.puts.size && !pending.dels.size && !pending.settings) {
          state.error = null;
          changedSinceError = false;
        }
      } catch (err) {
        if (isPermanent(err)) {
          // Retrying the rejected collection would fail the same way and block
          // every later change, so drop only that one. Everything else goes
          // back in the queue, including writes that already landed: their
          // versions were never bumped, so sending them again (harmless) is
          // what lets other devices see them. A rejected bump (current is
          // null) drops the batch, since retrying it would fail again.
          console.error(`[${log}] changes rejected by the server`, err);
          state.error = 'Some changes were rejected by the server and could not be saved.';
          changedSinceError = false;
          const keep = (req) => current !== null && req !== current;
          for (const p of puts) if (keep(`put:${p.coll}`) && !pending.dels.has(pkey(p.coll, p.id)) && !pending.puts.has(pkey(p.coll, p.id))) pending.puts.set(pkey(p.coll, p.id), p);
          for (const d of dels) if (keep(`del:${d.coll}`) && !pending.puts.has(pkey(d.coll, d.id))) pending.dels.set(pkey(d.coll, d.id), d);
          if (doSettings && keep('settings')) pending.settings = mergeSettings(doSettings, pending.settings || {});
          notify(['sync']);
        } else {
          // Put back everything that has not been superseded meanwhile.
          for (const p of puts) if (!pending.dels.has(pkey(p.coll, p.id)) && !pending.puts.has(pkey(p.coll, p.id))) pending.puts.set(pkey(p.coll, p.id), p);
          for (const d of dels) if (!pending.puts.has(pkey(d.coll, d.id))) pending.dels.set(pkey(d.coll, d.id), d);
          if (doSettings) pending.settings = mergeSettings(doSettings, pending.settings || {});
          handleError(err);
        }
      } finally {
        inflight.puts.clear();
        inflight.dels.clear();
        inflight.settings = false;
        flushing = null;
        // Once nothing is waiting, the tab can close without a warning, so
        // the snapshot must stop listing these writes as unsent right away;
        // otherwise reopening would send old copies over newer edits.
        if (!pendingCount()) persistCacheNow();
        else persistCacheSoon();
        notify(['sync']);
      }
    })();
    await flushing;
    if (more && state.online && !flushTimer) return flush();
    if ((pending.puts.size || pending.dels.size || pending.settings) && state.online && !flushTimer) scheduleFlush();
  }

  function handleError(err) {
    console.warn(`[${log}] sync failed`, err);
    state.error = err?.message || String(err);
    setOnline(false);
    retryDelay = Math.min(60000, retryDelay ? retryDelay * 2 : 2000);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Until the first successful load, retry the load itself. With nothing
      // to send, a sync is what notices that the connection is back.
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
  let queuedOnly = null; // collections asked for while a sync was running
  async function sync({ only = null, force = false } = {}) {
    if (syncing) {
      if (only) queuedOnly = new Set([...(queuedOnly || []), ...only]);
      return syncing;
    }
    syncing = (async () => {
      state.syncing = true;
      notify(['sync']);
      try {
        const meta = await timed(backend.loadMeta());
        const names = only || [...COLLECTIONS, 'settings'];
        const changedColls = [];
        const raced = [];
        for (const n of names) {
          const remote = Number(meta?.[n]) || 0;
          if (!force && known[n] !== undefined && known[n] === remote) continue;
          // A local write that lands while this read is on its way may be
          // missing from what comes back; read that collection again instead.
          const landedBefore = landed[n] || 0;
          if (n === 'settings') {
            const s = await timed(backend.loadSettings());
            if ((landed[n] || 0) !== landedBefore) {
              raced.push(n);
              continue;
            }
            state.settings = withLocalSettings(s);
          } else {
            const records = await timed(backend.loadCollection(n));
            if ((landed[n] || 0) !== landedBefore) {
              raced.push(n);
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
        retryDelay = 0;
        setOnline(true);
        if (changedColls.length) {
          persistCacheSoon();
          notify(changedColls);
        }
        if (raced.length) queuedOnly = new Set([...(queuedOnly || []), ...raced]);
        if (pending.puts.size || pending.dels.size || pending.settings) {
          // Send what waited now rather than when a retry timer fires.
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
  let cacheOff = false; // after sign out, nothing is written to this device
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
        settings: pending.settings || inflight.settings ? localSettingsChanges() : false,
      },
    };
  }

  function persistCacheSoon() {
    if (!cache || cacheOff || cacheTimer) return;
    cacheTimer = setTimeout(persistCacheNow, 600);
  }

  function persistCacheNow() {
    if (!cache || cacheOff) return;
    clearTimeout(cacheTimer);
    cacheTimer = null;
    cache.save(snapshot()).catch((err) => console.warn(`[${log}] cache write failed`, err));
  }

  function hydrate(snap) {
    for (const c of COLLECTIONS) {
      const m = new Map();
      for (const r of snap.collections?.[c] || []) m.set(r.id, r);
      data[c] = m;
      invalidate(c);
    }
    state.settings = mergeSettings(defaultSettings(), snap.settings || {});
    // A cache saved before the first successful load knows nothing about the
    // backend's versions yet.
    if (snap.synced !== false) Object.assign(known, snap.known || {});
    for (const p of snap.pending?.puts || []) pending.puts.set(pkey(p.coll, p.id), p);
    for (const d of snap.pending?.dels || []) pending.dels.set(pkey(d.coll, d.id), d);
    // Snapshots from before changes were kept only flagged them: treat the
    // whole local settings as the change, as they were then.
    const ps = snap.pending?.settings;
    if (ps) pending.settings = typeof ps === 'object' ? ps : structuredClone(state.settings);
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

  /** Add or replace many records at once (import, sample data, bill runs). */
  function bulkPut(coll, records) {
    const ts = now();
    const out = [];
    for (const r of records) {
      const rec = { ...r, id: r.id || newId(), createdAt: r.createdAt || ts, updatedAt: ts };
      data[coll].set(rec.id, rec);
      pending.dels.delete(pkey(coll, rec.id));
      pending.puts.set(pkey(coll, rec.id), { coll, id: rec.id });
      out.push(rec);
    }
    invalidate(coll);
    notify([coll]);
    noteChange();
    scheduleFlush();
    return out;
  }

  function bulkRemove(coll, ids) {
    for (const id of ids) {
      if (!data[coll].delete(id)) continue;
      pending.puts.delete(pkey(coll, id));
      pending.dels.set(pkey(coll, id), { coll, id });
    }
    invalidate(coll);
    notify([coll]);
    noteChange();
    scheduleFlush();
  }

  /** Delete this device's offline copy of the firm and stop writing it (sign out). */
  async function clearCache() {
    if (!cache) return;
    cacheOff = true;
    clearTimeout(cacheTimer);
    cacheTimer = null;
    await (cache.clearAll ? cache.clearAll() : cache.clear());
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
    clearCache,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get backendKind() {
      return backend.kind;
    },
  };
}
