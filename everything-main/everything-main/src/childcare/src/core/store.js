/**
 * The app's single source of truth.
 *
 * Records live in memory as Maps keyed by id, one Map per collection or
 * partition (see keys.js). Every change is applied locally first, so the UI
 * never waits on the network, then written to the backend in small batches.
 * Version counters in the backend tell this device when another device
 * changed something, so a sync only re-reads what actually moved.
 *
 * Static collections load at start. Partitions (a day of activities, a
 * family's conversation) load when a screen opens them, and stay synced
 * while they are in memory. Only the most recently used partitions are kept.
 *
 * An optional cache (IndexedDB in the browser) holds a snapshot plus any
 * writes that have not reached the backend yet, so the app opens instantly
 * and survives going offline.
 */
import { newId } from './ids.js';
import { defaultSettings, mergeSettings } from './settings.js';
import { COLLECTIONS, baseOf, splitName, metaKeysFor, isValidName } from './keys.js';

export { COLLECTIONS };

const NUMBERED = { invoices: 'invoice' };
const LOG = '[childcare]';

export function createStore({
  backend,
  cache = null,
  now = () => new Date().toISOString(),
  flushDelay = 250,
  timeoutMs = 45000,
  maxPartitions = 60,
} = {}) {
  const data = new Map(COLLECTIONS.map((c) => [c, new Map()]));
  const listCache = new Map();
  const known = {}; // name -> backend version this device has
  const loaded = new Set(); // partitions loaded from the backend (or cache)
  const lastUsed = new Map(); // partition -> ms
  const remoteMeta = {}; // every version seen, including unloaded partitions
  // Keyed `${name}\u0000${id}`; settings holds the unsent changes (or false).
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
  function notify(names = []) {
    for (const n of names) {
      changed.add(n);
      changed.add(baseOf(n));
    }
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

  const isPartition = (name) => splitName(name).key !== null;

  function map(name) {
    let m = data.get(name);
    if (!m) {
      if (!isValidName(name)) throw new Error(`Unknown collection: ${name}`);
      m = new Map();
      data.set(name, m);
    }
    return m;
  }

  function all(name) {
    let list = listCache.get(name);
    if (!list) {
      list = data.has(name) ? [...data.get(name).values()] : [];
      listCache.set(name, list);
    }
    if (isPartition(name)) lastUsed.set(name, Date.now());
    return list;
  }

  function get(name, id) {
    return id ? data.get(name)?.get(id) ?? null : null;
  }

  const pkey = (name, id) => `${name}\u0000${id}`;

  function stage(name, rec) {
    map(name).set(rec.id, rec);
    pending.dels.delete(pkey(name, rec.id));
    pending.puts.set(pkey(name, rec.id), { coll: name, id: rec.id });
    listCache.delete(name);
  }

  function put(name, record) {
    const ts = now();
    const rec = { ...record };
    if (!rec.id) rec.id = newId();
    if (!rec.createdAt) rec.createdAt = ts;
    rec.updatedAt = ts;
    stage(name, rec);
    notify([name]);
    scheduleFlush();
    return rec;
  }

  function patch(name, id, changes) {
    const cur = get(name, id);
    if (!cur) return null;
    const next = typeof changes === 'function' ? changes(structuredClone(cur)) : { ...cur, ...changes };
    return put(name, next);
  }

  function remove(name, id) {
    const cur = get(name, id);
    if (!cur) return null;
    data.get(name).delete(id);
    pending.puts.delete(pkey(name, id));
    pending.dels.set(pkey(name, id), { coll: name, id });
    listCache.delete(name);
    notify([name]);
    scheduleFlush();
    return cur;
  }

  /** Put back a record removed a moment ago (undo). */
  function restore(name, record) {
    stage(name, record);
    notify([name]);
    scheduleFlush();
    return record;
  }

  /** Replace or merge many records at once (import, sample data). */
  function bulkPut(name, records) {
    const ts = now();
    for (const r of records) stage(name, { ...r, id: r.id || newId(), createdAt: r.createdAt || ts, updatedAt: ts });
    notify([name]);
    scheduleFlush();
  }

  function bulkRemove(name, ids) {
    const m = data.get(name);
    if (!m) return;
    for (const id of ids) {
      if (!m.delete(id)) continue;
      pending.puts.delete(pkey(name, id));
      pending.dels.set(pkey(name, id), { coll: name, id });
    }
    listCache.delete(name);
    notify([name]);
    scheduleFlush();
  }

  function saveSettings(changes) {
    state.settings = mergeSettings(state.settings, changes);
    pending.settings = mergeSettings(pending.settings || {}, structuredClone(changes));
    notify(['settings']);
    scheduleFlush();
    return state.settings;
  }

  /** The first of `count` new document numbers, reserved in the backend. */
  async function nextNumber(coll, count = 1) {
    const kind = NUMBERED[coll];
    let localMax = Math.max(0, (state.settings.numbering?.[kind] ?? 1) - 1);
    for (const r of all(coll)) if (Number(r.number) > localMax) localMax = Number(r.number);
    try {
      // atLeast moves the shared counter past numbers already in use, so two
      // devices never hand out the same number.
      const n = await timed(backend.nextNumber(kind, localMax + 1, count));
      return Math.max(Number(n) || 0, localMax + 1);
    } catch {
      return localMax + 1;
    }
  }

  // ---- Writing -----------------------------------------------------------

  // Writes being sent right now. They count as local changes for a sync
  // that overlaps them and for the offline cache, until they land.
  const inflight = { puts: new Map(), dels: new Map(), settings: false };

  /** Settings changes made here that have not landed, or null. */
  function settingsChanges() {
    if (!pending.settings && !inflight.settings) return null;
    return mergeSettings(inflight.settings || {}, pending.settings || {});
  }
  const unbumped = new Set(); // written, but the version bump did not land yet
  let flushTimer = null;
  let flushing = null;
  let retryDelay = 0;
  let syncEpoch = 0; // bumped every time a sync reloads anything
  const reloadedAt = new Map(); // name -> syncEpoch of the sync that last reloaded it

  // Writes that landed while a load (sync or open) was under way. That load
  // may have read the backend just before they did, so the local copies win
  // over what it returns; the next sync then reads the settled state.
  const landed = new Map(); // key `${name}\u0000${id}` -> { coll, id, del, seq }
  let landSeq = 0;
  let loadsRunning = 0;
  function noteLanded(coll, ids, del) {
    if (!loadsRunning) return;
    for (const id of ids) landed.set(pkey(coll, id), { coll, id, del, seq: ++landSeq });
  }
  function startLoad() {
    loadsRunning++;
    return landSeq;
  }
  function endLoad() {
    if (!--loadsRunning) landed.clear();
  }

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

  const hasPending = () => pending.puts.size || pending.dels.size || pending.settings || unbumped.size;

  /** Errors a retry cannot fix (the server rejected the data itself). */
  function isPermanent(err) {
    const s = Number(err?.status) || 0;
    return s >= 400 && s < 500 && ![401, 408, 425, 429].includes(s);
  }

  async function flush() {
    if (flushing) {
      await flushing;
      if (hasPending()) return flush();
      return;
    }
    if (!hasPending()) return;
    flushing = (async () => {
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
      try {
        const touched = new Set();
        const rejected = new Set();
        const sentPuts = new Set(); // names whose puts landed
        const sentDels = new Set();
        let failure = null;
        // Each collection is sent on its own: one the server refuses (a family
        // reporting an absence after check-in, say) must not take the others
        // down with it.
        const step = async (name, fn) => {
          if (failure) return;
          try {
            await timed(fn());
            touched.add(name);
            return true;
          } catch (err) {
            if (isPermanent(err)) {
              console.error(`${LOG} changes to ${name} rejected by the server`, err);
              rejected.add(name);
              state.error = err?.message || 'Some changes were rejected by the server and could not be saved.';
            } else failure = err;
          }
        };
        const byName = new Map();
        for (const p of puts) {
          const rec = get(p.coll, p.id);
          if (!rec) continue;
          if (!byName.has(p.coll)) byName.set(p.coll, []);
          byName.get(p.coll).push(rec);
        }
        for (const [name, recs] of byName) {
          if (!(await step(name, () => backend.putRecords(name, recs)))) continue;
          sentPuts.add(name);
          noteLanded(name, recs.map((r) => r.id), false);
        }
        const delsByName = new Map();
        for (const d of dels) {
          if (!delsByName.has(d.coll)) delsByName.set(d.coll, []);
          delsByName.get(d.coll).push(d.id);
        }
        for (const [name, ids] of delsByName) {
          if (!(await step(name, () => backend.deleteRecords(name, ids)))) continue;
          sentDels.add(name);
          noteLanded(name, ids, true);
        }
        if (doSettings)
          await step('settings', async () => {
            // Settings are one item: apply this device's changes to the
            // latest copy, so another device's changes meanwhile are kept.
            const remote = mergeSettings(defaultSettings(), (await backend.loadSettings()) || {});
            const next = mergeSettings(remote, doSettings);
            await backend.saveSettings(next);
            state.settings = mergeSettings(next, pending.settings || {});
            notify(['settings']);
          });
        try {
          // Announce whatever landed, even when something after it failed.
          const names = [...new Set([...touched, ...unbumped])];
          if (names.length) {
            let versions;
            try {
              versions = await timed(backend.bumpVersions(names));
              unbumped.clear();
            } catch (err) {
              for (const n of touched) unbumped.add(n);
              throw err;
            }
            Object.assign(remoteMeta, versions);
            const stale = [];
            for (const n of names) {
              const v = Number(versions?.[n]) || 0;
              // Current only if this device had loaded the name, nobody else
              // wrote in between (our bump is the only one), and no sync
              // reloaded it while our write was on its way.
              const current = touched.has(n) && knownAtStart[n] !== undefined && known[n] === knownAtStart[n] && !((reloadedAt.get(n) || 0) > epochAtStart) && knownAtStart[n] + 1 === v;
              if (current) known[n] = v;
              else if (n === 'settings' || !isPartition(n) || loaded.has(n)) stale.push(n);
              else known[n] = v; // written without being opened: nothing to refresh
            }
            if (stale.length) queueMicrotask(() => sync({ only: stale }));
          }
          if (failure) throw failure;
          retryDelay = 0;
          if (!rejected.size) setOnline(true);
        } catch (err) {
          // Put back everything not sent, not refused, and not superseded
          // meanwhile. What landed only needs its version bump (unbumped).
          for (const p of puts) if (!sentPuts.has(p.coll) && !rejected.has(p.coll) && !pending.dels.has(pkey(p.coll, p.id)) && !pending.puts.has(pkey(p.coll, p.id))) pending.puts.set(pkey(p.coll, p.id), p);
          for (const d of dels) if (!sentDels.has(d.coll) && !rejected.has(d.coll) && !pending.puts.has(pkey(d.coll, d.id))) pending.dels.set(pkey(d.coll, d.id), d);
          if (doSettings && !rejected.has('settings')) pending.settings = mergeSettings(doSettings, pending.settings || {});
          handleError(err);
        }
        if (rejected.size) {
          // Show the server's copy again instead of the refused local one.
          const names = [...rejected];
          queueMicrotask(() => sync({ only: names, force: true }));
          notify(['sync', 'rejected']);
        }
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

  function handleError(err) {
    console.warn(`${LOG} sync failed`, err);
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

  /**
   * Replace a name's records with what the backend sent, keeping unsent
   * local writes and those that landed after the load began (`since`).
   */
  function applyLoaded(name, records, since = landSeq) {
    const m = withLocal(name, records, since);
    data.set(name, m);
    listCache.delete(name);
    if (isPartition(name)) {
      loaded.add(name);
      lastUsed.set(name, Date.now());
    }
  }

  /** What the backend sent, with this device's unsent writes applied (see applyLoaded). */
  function withLocal(name, records, since) {
    const m = new Map();
    for (const r of records || []) if (r && r.id) m.set(r.id, r);
    const local = data.get(name);
    for (const w of landed.values()) {
      if (w.coll !== name || w.seq <= since) continue;
      if (w.del) m.delete(w.id);
      else if (local?.has(w.id)) m.set(w.id, local.get(w.id));
    }
    for (const q of [pending.puts, inflight.puts]) for (const p of q.values()) if (p.coll === name && local?.has(p.id)) m.set(p.id, local.get(p.id));
    for (const q of [pending.dels, inflight.dels]) for (const d of q.values()) if (d.coll === name) m.delete(d.id);
    return m;
  }

  let syncing = null;
  let queued = null; // { only, force } names asked for while a sync was running
  async function sync({ only = null, force = false } = {}) {
    if (syncing) {
      // Run them right after, keeping `force` (refused writes, access
      // changes); the caller's promise settles once they are done.
      queued ||= { only: new Set(), force: new Set() };
      for (const n of only || [...COLLECTIONS, 'settings', ...loaded]) {
        queued.only.add(n);
        if (force) queued.force.add(n);
      }
      return syncing;
    }
    syncing = (async () => {
      state.syncing = true;
      notify(['sync']);
      const since = startLoad();
      try {
        const names = only || [...COLLECTIONS, 'settings', ...loaded];
        const meta = await timed(backend.loadMeta(metaKeysFor(names.filter((n) => n !== 'settings'))));
        Object.assign(remoteMeta, meta);
        const moved = names.filter((n) => force === true || force?.has?.(n) || known[n] === undefined || known[n] !== (Number(meta?.[n]) || 0));
        const colls = moved.filter((n) => n !== 'settings');
        if (moved.includes('settings')) {
          const s = await timed(backend.loadSettings());
          state.settings = mergeSettings(mergeSettings(defaultSettings(), s || {}), settingsChanges() || {});
        }
        if (colls.length) {
          const res = await timed(backend.loadCollections(colls));
          for (const n of colls) applyLoaded(n, res?.[n], since);
        }
        for (const n of moved) known[n] = Number(meta?.[n]) || 0;
        if (moved.length) syncEpoch++;
        for (const n of moved) reloadedAt.set(n, syncEpoch);
        state.lastSyncedAt = now();
        if (!only) {
          state.synced = true;
          state.remoteEmpty = !COLLECTIONS.some((c) => meta?.[c]) && !meta?.settings;
        }
        setOnline(true);
        if (moved.length) {
          persistCacheSoon();
          notify(moved);
        }
        if (hasPending()) {
          // The backend answers again: send now, not when the backoff ends.
          clearTimeout(flushTimer);
          flushTimer = null;
          scheduleFlush(0);
        }
      } catch (err) {
        handleError(err);
      } finally {
        endLoad();
        state.syncing = false;
        syncing = null;
        notify(['sync']);
      }
      if (queued) {
        const next = queued;
        queued = null;
        await sync({ only: [...next.only], force: next.force });
      }
    })();
    return syncing;
  }

  // ---- Partitions ----------------------------------------------------------

  const opening = new Map(); // name -> promise

  /**
   * Make sure these partitions are in memory (loading what is missing in one
   * round trip) and keep them synced. Resolves true when all are loaded.
   */
  async function open(names) {
    const list = [...new Set(names)].filter((n) => isPartition(n));
    for (const n of list) lastUsed.set(n, Date.now());
    const missing = list.filter((n) => !loaded.has(n) && !opening.has(n));
    if (missing.length) {
      const p = (async () => {
        const since = startLoad();
        try {
          const meta = await timed(backend.loadMeta(metaKeysFor(missing)));
          Object.assign(remoteMeta, meta);
          // Partitions the meta says were never written need no query at all.
          const toLoad = missing.filter((n) => Number(meta?.[n]) > 0 || !state.synced);
          const res = toLoad.length ? await timed(backend.loadCollections(toLoad)) : {};
          for (const n of missing) {
            applyLoaded(n, res?.[n] || [], since);
            known[n] = Number(meta?.[n]) || 0;
          }
          evict(new Set(list));
          persistCacheSoon();
          notify(missing);
        } finally {
          endLoad();
        }
      })();
      for (const n of missing) opening.set(n, p);
      p.catch(() => {}).finally(() => {
        for (const n of missing) if (opening.get(n) === p) opening.delete(n);
      });
    }
    try {
      await Promise.all(list.map((n) => opening.get(n)).filter(Boolean));
      return list.every((n) => loaded.has(n));
    } catch (err) {
      console.warn(`${LOG} could not open`, list, err);
      setOnline(false);
      return false;
    }
  }

  function isOpen(name) {
    return loaded.has(name);
  }

  /**
   * Drop the least recently used partitions that have nothing unsent,
   * never the ones just asked for (`keep`).
   */
  function evict(keep = new Set()) {
    if (loaded.size <= maxPartitions) return;
    const busy = new Set([...keep, ...[...pending.puts.values(), ...pending.dels.values(), ...inflight.puts.values(), ...inflight.dels.values()].map((p) => p.coll)]);
    const order = [...loaded].filter((n) => !busy.has(n)).sort((a, b) => (lastUsed.get(a) || 0) - (lastUsed.get(b) || 0));
    while (loaded.size > maxPartitions && order.length) {
      const n = order.shift();
      loaded.delete(n);
      data.delete(n);
      listCache.delete(n);
      lastUsed.delete(n);
      delete known[n];
    }
  }

  /**
   * Read partitions for a report without keeping them in memory: what is
   * already loaded comes from memory, the rest from the backend, and days
   * the meta says were never written cost nothing. Resolves { name: records }.
   */
  async function read(names) {
    const out = {};
    const need = [...new Set(names)].filter((n) => !loaded.has(n));
    // In case one is evicted while the rest load.
    for (const n of names) if (loaded.has(n)) out[n] = all(n);
    if (need.length) {
      const since = startLoad();
      try {
        const meta = await timed(backend.loadMeta(metaKeysFor(need)));
        Object.assign(remoteMeta, meta);
        const toLoad = need.filter((n) => Number(meta?.[n]) > 0);
        const res = {};
        for (let i = 0; i < toLoad.length; i += 40) Object.assign(res, await timed(backend.loadCollections(toLoad.slice(i, i + 40))));
        // Unsent local writes win, as in a sync; records sent earlier do not.
        for (const n of need) out[n] = [...withLocal(n, res[n], since).values()];
      } finally {
        endLoad();
      }
    }
    for (const n of names) if (loaded.has(n)) out[n] = all(n);
    return out;
  }

  /**
   * Read meta items without loading any records, e.g. to learn which days
   * of a month have activities. Resolves the versions found ({ name: v }).
   */
  async function peekMeta(metaKeys) {
    try {
      const meta = await timed(backend.loadMeta(metaKeys));
      Object.assign(remoteMeta, meta);
      return meta;
    } catch (err) {
      console.warn(`${LOG} could not read versions`, err);
      return null;
    }
  }

  /** Names of partitions of `base` known (from any meta read) to hold data. */
  function knownPartitions(base) {
    const out = new Set();
    for (const [n, v] of Object.entries(remoteMeta)) if (v > 0 && baseOf(n) === base && isPartition(n)) out.add(n);
    for (const n of data.keys()) if (baseOf(n) === base && isPartition(n) && data.get(n).size) out.add(n);
    return [...out].sort();
  }

  // ---- Cache -------------------------------------------------------------

  let cacheTimer = null;
  function snapshot() {
    const merge = (a, b) => [...new Map([...a, ...b]).values()];
    const pendingPuts = merge(inflight.puts, pending.puts);
    const pendingDels = merge(inflight.dels, pending.dels);
    const busy = new Set([...pendingPuts, ...pendingDels].map((p) => p.coll));
    // Keep the recently used partitions and any with unsent changes.
    const parts = [...data.keys()]
      .filter((n) => isPartition(n) && (loaded.has(n) || busy.has(n)))
      .sort((a, b) => (lastUsed.get(b) || 0) - (lastUsed.get(a) || 0))
      .filter((n, i) => i < 24 || busy.has(n));
    const names = [...COLLECTIONS, ...parts];
    return {
      v: 2,
      // Read the maps directly: all() would mark every partition as just used.
      collections: Object.fromEntries(names.map((c) => [c, [...(data.get(c)?.values() || [])]])),
      loaded: parts.filter((n) => loaded.has(n)),
      settings: state.settings,
      known: Object.fromEntries(Object.entries(known).filter(([n]) => !isPartition(n) || parts.includes(n))),
      synced: state.synced,
      pending: { puts: pendingPuts, dels: pendingDels, settings: settingsChanges() || false },
      unbumped: [...unbumped],
    };
  }

  function persistCacheSoon() {
    if (!cache || cacheTimer) return;
    cacheTimer = setTimeout(() => {
      cacheTimer = null;
      cache.save(snapshot()).catch((err) => console.warn(`${LOG} cache write failed`, err));
    }, 600);
  }

  /** Save a snapshot that is due now, e.g. when the page is being hidden. */
  function persist() {
    if (!cache || !cacheTimer) return;
    clearTimeout(cacheTimer);
    cacheTimer = null;
    cache.save(snapshot()).catch((err) => console.warn(`${LOG} cache write failed`, err));
  }

  /** Stop writing the offline cache (signing out removes it). */
  function close() {
    clearTimeout(cacheTimer);
    cacheTimer = null;
    cache = null;
  }

  function hydrate(snap) {
    for (const [name, records] of Object.entries(snap.collections || {})) {
      if (!isValidName(name)) continue;
      const m = new Map();
      for (const r of records || []) m.set(r.id, r);
      data.set(name, m);
      listCache.delete(name);
    }
    for (const n of snap.loaded || []) if (data.has(n)) loaded.add(n);
    state.settings = mergeSettings(defaultSettings(), snap.settings || {});
    // A cache saved before the first successful load knows nothing about
    // the backend's versions yet.
    if (snap.synced !== false) Object.assign(known, snap.known || {});
    for (const p of snap.pending?.puts || []) if (isValidName(p.coll)) pending.puts.set(pkey(p.coll, p.id), p);
    for (const d of snap.pending?.dels || []) if (isValidName(d.coll)) pending.dels.set(pkey(d.coll, d.id), d);
    // Older snapshots only flagged that the settings had unsent changes.
    if (snap.pending?.settings) pending.settings = typeof snap.pending.settings === 'object' ? snap.pending.settings : structuredClone(state.settings);
    for (const n of snap.unbumped || []) if (isValidName(n)) unbumped.add(n);
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
        if (snap?.v === 2) {
          hydrate(snap);
          fromCache = true;
          state.synced = snap.synced !== false;
        }
      } catch (err) {
        console.warn(`${LOG} cache read failed`, err);
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
    open,
    isOpen,
    read,
    peekMeta,
    knownPartitions,
    pendingCount,
    snapshot,
    persist,
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
