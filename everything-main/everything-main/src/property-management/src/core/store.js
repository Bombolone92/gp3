/**
 * The app's single source of truth.
 *
 * Records live in memory as Maps keyed by id. Every change is applied
 * locally first (so the UI never waits on the network), then written to the
 * backend in small batches. A per-collection version counter in the backend
 * tells this device when another device changed something, so a sync only
 * re-reads the collections that actually moved.
 *
 * Collections that grow without bound (the ledger) are split by month into
 * physical partitions ('tx.2026-10'), each with its own version. Recording a
 * payment then makes other devices re-read one month, not years of history.
 * Views never see partitions: store.all('transactions') is the whole ledger.
 *
 * An optional cache (IndexedDB in the browser) holds a snapshot plus any
 * writes that have not reached the backend yet, so the app opens instantly
 * and survives going offline.
 */
import { newId } from './ids.js';
import { defaultSettings, mergeSettings } from './settings.js';

export const COLLECTIONS = [
  'properties',
  'units',
  'leases',
  'tenants',
  'owners',
  'vendors',
  'applicants',
  'workOrders',
  'tasks',
  'accounts',
  'reconciliations',
  'budgets',
  'inspections',
  'messages',
  'events',
  'team',
  'transactions',
];

/** Logical collections stored as monthly partitions, keyed by a date field. */
export const PARTITIONED = {
  transactions: { prefix: 'tx.', field: 'date' },
};

const PARTITION_RE = /^([a-z]+)\.([1-9]\d{3}-(0[1-9]|1[0-2]))$/;
const PLAIN = COLLECTIONS.filter((c) => !PARTITIONED[c]);

/** Physical collection name for a record ('tx.2026-10' or the logical name). */
export function physicalName(coll, record) {
  const p = PARTITIONED[coll];
  if (!p) return coll;
  const month = /^\d{4}-\d{2}/.exec(String(record?.[p.field] || ''))?.[0] || '0000-00';
  return `${p.prefix}${month}`;
}

/** Logical collection for a physical name, or null if it is not one of ours. */
export function logicalName(phys) {
  if (PLAIN.includes(phys)) return phys;
  const m = PARTITION_RE.exec(phys);
  if (!m) return null;
  for (const [coll, p] of Object.entries(PARTITIONED)) if (p.prefix === `${m[1]}.`) return coll;
  return null;
}

export function isPhysicalName(name) {
  return logicalName(name) !== null;
}

const NUMBERED = { leases: 'lease', workOrders: 'workOrder', tasks: 'task' };

export function createStore({ backend, cache = null, now = () => new Date().toISOString(), flushDelay = 250, timeoutMs = 45000 } = {}) {
  // Physical collection -> Map(id -> record).
  const data = new Map(PLAIN.map((c) => [c, new Map()]));
  // For partitioned collections: id -> physical name that holds it.
  const where = Object.fromEntries(Object.keys(PARTITIONED).map((c) => [c, new Map()]));
  const listCache = new Map();
  const revs = Object.fromEntries(COLLECTIONS.map((c) => [c, 0]));
  const known = {}; // physical collection -> backend version this device has
  const pending = { puts: new Map(), dels: new Map(), settings: false }; // key `${phys}\u0000${id}`
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

  function physMap(phys) {
    let m = data.get(phys);
    if (!m) {
      m = new Map();
      data.set(phys, m);
    }
    return m;
  }

  function partitionsOf(coll) {
    const prefix = PARTITIONED[coll].prefix;
    return [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  function invalidate(coll) {
    listCache.delete(coll);
    revs[coll] = (revs[coll] || 0) + 1;
  }

  function assertColl(coll) {
    if (!COLLECTIONS.includes(coll)) throw new Error(`Unknown collection: ${coll}`);
  }

  function all(coll) {
    let list = listCache.get(coll);
    if (!list) {
      if (PARTITIONED[coll]) {
        list = [];
        const w = where[coll];
        // A record moving between months can sit in two partitions for a
        // moment during a sync; `where` names the one that counts.
        for (const phys of partitionsOf(coll)) for (const r of data.get(phys).values()) if (w.get(r.id) === phys) list.push(r);
      } else {
        list = [...(data.get(coll)?.values() || [])];
      }
      listCache.set(coll, list);
    }
    return list;
  }

  function get(coll, id) {
    if (!id) return null;
    if (PARTITIONED[coll]) {
      const phys = where[coll].get(id);
      return phys ? data.get(phys)?.get(id) ?? null : null;
    }
    return data.get(coll)?.get(id) ?? null;
  }

  const pkey = (phys, id) => `${phys}\u0000${id}`;

  function markPut(phys, id) {
    pending.dels.delete(pkey(phys, id));
    pending.puts.set(pkey(phys, id), { coll: phys, id });
  }

  function markDel(phys, id) {
    pending.puts.delete(pkey(phys, id));
    pending.dels.set(pkey(phys, id), { coll: phys, id });
  }

  /** Store a record locally; returns the physical names touched. */
  function place(coll, rec) {
    const phys = physicalName(coll, rec);
    if (PARTITIONED[coll] && !PARTITION_RE.test(phys)) throw new Error(`A ${coll} record needs a valid date.`);
    if (PARTITIONED[coll]) {
      const prev = where[coll].get(rec.id);
      if (prev && prev !== phys) {
        data.get(prev)?.delete(rec.id);
        markDel(prev, rec.id);
        cacheDirty.add(prev);
      }
      where[coll].set(rec.id, phys);
    }
    physMap(phys).set(rec.id, rec);
    markPut(phys, rec.id);
    cacheDirty.add(phys);
  }

  function unplace(coll, id) {
    const phys = PARTITIONED[coll] ? where[coll].get(id) : coll;
    if (!phys || !data.get(phys)?.has(id)) return false;
    data.get(phys).delete(id);
    if (PARTITIONED[coll]) where[coll].delete(id);
    markDel(phys, id);
    cacheDirty.add(phys);
    return true;
  }

  function put(coll, record) {
    assertColl(coll);
    const ts = now();
    const rec = { ...record };
    if (!rec.id) rec.id = newId();
    if (!rec.createdAt) rec.createdAt = ts;
    rec.updatedAt = ts;
    place(coll, rec);
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
    unplace(coll, id);
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return cur;
  }

  /** Put back a record removed a moment ago (undo). */
  function restore(coll, record) {
    place(coll, record);
    invalidate(coll);
    notify([coll]);
    scheduleFlush();
    return record;
  }

  // Settings changes not yet saved, kept apart so they can be laid over a
  // newer copy from another device instead of overwriting it.
  let settingsDiff = null;

  function saveSettings(changes) {
    state.settings = mergeSettings(state.settings, changes);
    settingsDiff = mergeSettings(settingsDiff || {}, changes);
    pending.settings = true;
    notify(['settings']);
    scheduleFlush();
    return state.settings;
  }

  async function nextNumber(coll) {
    const kind = NUMBERED[coll];
    let localMax = Math.max(0, (state.settings.numbering?.[kind] ?? 1) - 1);
    for (const r of all(coll)) if (Number(r.number) > localMax) localMax = Number(r.number);
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
    return s >= 400 && s < 500 && ![401, 403, 408, 425, 429].includes(s);
  }

  async function flush() {
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
      const diffSent = settingsDiff;
      pending.puts.clear();
      pending.dels.clear();
      pending.settings = false;
      const epochAtStart = syncEpoch;
      const knownAtStart = { ...known };
      const touched = new Set();
      // Each collection's write succeeds or fails on its own: a record the
      // server rejects must not take unrelated changes down with it, and
      // every collection that was written still gets its version bumped.
      const done = new Set(); // pending keys that landed or were rejected
      let transient = null;
      let rejected = false;
      const reject = (coll, keys, err) => {
        console.error('[property-management] changes rejected by the server', coll, err);
        rejected = true;
        for (const k of keys) done.add(k);
      };
      // Returns the error when the server refused the write, else nothing.
      const attempt = async (coll, keys, fn) => {
        if (transient) return null;
        try {
          await timed(fn());
          touched.add(coll);
          for (const k of keys) done.add(k);
        } catch (err) {
          if (isPermanent(err)) return err;
          transient = err;
        }
        return null;
      };
      const run = async (coll, keys, fn) => {
        const err = await attempt(coll, keys, fn);
        if (err) reject(coll, keys, err);
      };
      const byColl = new Map();
      for (const p of puts) {
        const rec = data.get(p.coll)?.get(p.id);
        if (!rec) {
          done.add(pkey(p.coll, p.id));
          continue;
        }
        if (!byColl.has(p.coll)) byColl.set(p.coll, []);
        byColl.get(p.coll).push(rec);
      }
      for (const [coll, recs] of byColl) {
        const err = await attempt(coll, recs.map((r) => pkey(coll, r.id)), () => backend.putRecords(coll, recs));
        if (!err) continue;
        // One record the server refuses must not take the rest of the batch
        // with it: send them one at a time to find it.
        if (recs.length === 1) reject(coll, [pkey(coll, recs[0].id)], err);
        else for (const rec of recs) await run(coll, [pkey(coll, rec.id)], () => backend.putRecords(coll, [rec]));
      }
      const delsByColl = new Map();
      for (const d of dels) {
        if (!delsByColl.has(d.coll)) delsByColl.set(d.coll, []);
        delsByColl.get(d.coll).push(d.id);
      }
      for (const [coll, ids] of delsByColl) await run(coll, ids.map((id) => pkey(coll, id)), () => backend.deleteRecords(coll, ids));
      if (doSettings) await run('settings', ['settings'], () => backend.saveSettings(state.settings));
      if (touched.size) {
        const names = [...touched];
        try {
          const versions = await timed(backend.bumpVersions(names));
          const stale = [];
          for (const n of names) {
            const v = Number(versions?.[n]) || 0;
            // Current only if this device knew the collection's version
            // (a brand new partition counts as known at 0), nobody else wrote
            // in between (our bump is the only one), and no sync reloaded it
            // while our write was on its way.
            const base = knownAtStart[n] ?? (isNewPartition(n) ? 0 : undefined);
            const current = base !== undefined && (known[n] ?? base) === base && syncEpoch === epochAtStart && base + 1 === v;
            if (current) known[n] = v;
            else stale.push(n);
          }
          if (stale.length) queueMicrotask(() => sync({ only: stale }));
        } catch (err) {
          // Written but not announced: send those collections again so the
          // next flush bumps their versions (rewriting is harmless).
          for (const k of [...done]) if (touched.has(k === 'settings' ? 'settings' : k.split('\u0000')[0])) done.delete(k);
          transient ??= err;
        }
      }
      try {
        // Put back everything that did not land and was not superseded meanwhile.
        for (const p of puts) {
          const k = pkey(p.coll, p.id);
          if (!done.has(k) && !pending.dels.has(k) && !pending.puts.has(k)) pending.puts.set(k, p);
        }
        for (const d of dels) {
          const k = pkey(d.coll, d.id);
          if (!done.has(k) && !pending.puts.has(k)) pending.dels.set(k, d);
        }
        if (doSettings && !done.has('settings')) pending.settings = true;
        else if (doSettings && settingsDiff === diffSent) settingsDiff = null;
        if (transient) handleError(transient);
        else {
          retryDelay = 0;
          setOnline(true);
        }
        if (rejected) {
          state.error = 'Some changes were rejected by the server and could not be saved.';
          notify(['sync']);
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
    if ((pending.puts.size || pending.dels.size || pending.settings) && state.online && !flushTimer) scheduleFlush();
  }

  // A partition this device created and the last full sync did not see in
  // the backend's meta. Its remote version starts at 0.
  let metaNames = new Set();
  function isNewPartition(n) {
    return state.synced && !PLAIN.includes(n) && n !== 'settings' && !metaNames.has(n);
  }

  function handleError(err) {
    console.warn('[property-management] sync failed', err);
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

  /** Replace one physical collection with what the backend returned. */
  function applyLoaded(phys, records) {
    const coll = logicalName(phys);
    const m = new Map();
    for (const r of records) if (r && r.id) m.set(r.id, r);
    // Local writes that have not landed yet win over what we read.
    for (const q of [pending.puts, inflight.puts]) for (const p of q.values()) if (p.coll === phys && data.get(phys)?.has(p.id)) m.set(p.id, data.get(phys).get(p.id));
    for (const q of [pending.dels, inflight.dels]) for (const d of q.values()) if (d.coll === phys) m.delete(d.id);
    if (PARTITIONED[coll]) {
      const w = where[coll];
      for (const id of data.get(phys)?.keys() || []) if (w.get(id) === phys && !m.has(id)) w.delete(id);
      for (const id of [...m.keys()]) {
        const local = w.get(id);
        if (local && local !== phys) {
          // A local move to another month that has not landed keeps its new home.
          if (pending.puts.has(pkey(local, id)) || inflight.puts.has(pkey(local, id))) {
            m.delete(id);
            continue;
          }
          // The same record in two months (moved on one device while edited
          // on another): keep the newer copy and delete the other one.
          const other = data.get(local)?.get(id);
          if (other && (other.updatedAt || '') > (m.get(id).updatedAt || '')) {
            m.delete(id);
            markDel(phys, id);
            continue;
          }
          if (other) {
            data.get(local).delete(id);
            markDel(local, id);
            cacheDirty.add(local);
          }
        }
        w.set(id, phys);
      }
    }
    data.set(phys, m);
    cacheDirty.add(phys);
    invalidate(coll);
    return coll;
  }

  let syncing = null;
  let queuedOnly = null; // physical collections asked for while a sync was running
  async function sync({ only = null, force = false } = {}) {
    if (syncing) {
      if (only) queuedOnly = new Set([...(queuedOnly || []), ...only]);
      return syncing;
    }
    syncing = (async () => {
      state.syncing = true;
      notify(['sync']);
      try {
        const meta = (await timed(backend.loadMeta())) || {};
        const partitions = new Set();
        for (const k of Object.keys(meta)) if (!PLAIN.includes(k) && k !== 'settings' && isPhysicalName(k)) partitions.add(k);
        if (!only) metaNames = new Set(Object.keys(meta));
        else for (const k of Object.keys(meta)) metaNames.add(k);
        const names = only || [...PLAIN, 'settings', ...partitions];
        const changedColls = new Set();
        for (const n of names) {
          const remote = Number(meta[n]) || 0;
          if (!force && known[n] !== undefined && known[n] === remote) continue;
          if (n === 'settings') {
            const s = await timed(backend.loadSettings());
            // Changes made here that are not saved yet go on top.
            state.settings = mergeSettings(mergeSettings(defaultSettings(), s || {}), settingsDiff || {});
            changedColls.add('settings');
          } else if (isPhysicalName(n)) {
            const records = remote || !PARTITION_RE.test(n) ? await timed(backend.loadCollection(n)) : [];
            changedColls.add(applyLoaded(n, records));
          } else continue;
          known[n] = remote;
          syncEpoch++;
        }
        // A partition held locally that the backend no longer lists was
        // emptied elsewhere (or never written); keep only unsent writes.
        if (!only) {
          for (const coll of Object.keys(PARTITIONED)) {
            for (const phys of partitionsOf(coll)) {
              if (partitions.has(phys) || !data.get(phys).size) continue;
              if (known[phys] === undefined) continue;
              changedColls.add(applyLoaded(phys, []));
              delete known[phys];
            }
          }
        }
        state.lastSyncedAt = now();
        if (!only) state.synced = true;
        state.remoteEmpty = !Object.keys(meta).length;
        setOnline(true);
        if (changedColls.size) {
          persistCacheSoon();
          notify([...changedColls]);
        }
        if (pending.puts.size || pending.dels.size || pending.settings) {
          // Back online: send now rather than waiting out a retry backoff.
          clearTimeout(flushTimer);
          flushTimer = null;
          retryDelay = 0;
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
  function snapshot() {
    const merge = (a, b) => [...new Map([...a, ...b]).values()];
    const collections = {};
    for (const [phys, m] of data) if (m.size) collections[phys] = [...m.values()];
    return {
      v: 2,
      collections,
      settings: state.settings,
      known: { ...known },
      synced: state.synced,
      pending: {
        puts: merge(inflight.puts, pending.puts),
        dels: merge(inflight.dels, pending.dels),
        settings: pending.settings || inflight.settings,
        settingsDiff,
      },
    };
  }

  /** Stop writing the offline copy (signing out clears it). */
  function detachCache() {
    clearTimeout(cacheTimer);
    cacheTimer = null;
    cache = null;
  }

  // Collections changed since the offline copy was last written. A cache
  // that stores collections apart (IndexedDB) rewrites only these: one
  // month of ledger rather than years of it on every edit.
  const cacheDirty = new Set();
  let cacheAllDirty = true; // the first write after opening writes everything

  function persistCacheSoon() {
    if (!cache || cacheTimer) return;
    cacheTimer = setTimeout(() => {
      cacheTimer = null;
      if (!cache.saveParts) {
        cache.save(snapshot()).catch((err) => console.warn('[property-management] cache write failed', err));
        return;
      }
      const { collections, ...meta } = snapshot();
      const names = Object.keys(collections);
      const write = cacheAllDirty ? names : names.filter((n) => cacheDirty.has(n));
      const parts = Object.fromEntries(write.map((n) => [n, collections[n]]));
      cacheDirty.clear();
      cacheAllDirty = false;
      cache.saveParts({ ...meta, names }, parts).catch((err) => {
        cacheAllDirty = true; // write everything next time
        console.warn('[property-management] cache write failed', err);
      });
    }, 600);
  }

  function hydrate(snap) {
    for (const [phys, records] of Object.entries(snap.collections || {})) {
      const coll = logicalName(phys);
      if (!coll) continue;
      const m = new Map();
      for (const r of records || []) {
        m.set(r.id, r);
        if (PARTITIONED[coll]) where[coll].set(r.id, phys);
      }
      data.set(phys, m);
    }
    for (const c of COLLECTIONS) invalidate(c);
    state.settings = mergeSettings(defaultSettings(), snap.settings || {});
    // A cache saved before the first successful load knows nothing about
    // the backend's versions yet.
    if (snap.synced !== false) Object.assign(known, snap.known || {});
    for (const p of snap.pending?.puts || []) if (isPhysicalName(p.coll)) pending.puts.set(pkey(p.coll, p.id), p);
    for (const d of snap.pending?.dels || []) if (isPhysicalName(d.coll)) pending.dels.set(pkey(d.coll, d.id), d);
    if (snap.pending?.settings) {
      pending.settings = true;
      // An older snapshot kept no diff: its whole settings are the change.
      settingsDiff = snap.pending.settingsDiff || state.settings;
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
        if (snap?.v === 2) {
          hydrate(snap);
          fromCache = true;
          state.synced = snap.synced !== false;
        }
      } catch (err) {
        console.warn('[property-management] cache read failed', err);
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

  /** Replace or merge many records at once (import, sample data, posting). */
  function bulkPut(coll, records) {
    assertColl(coll);
    if (!records.length) return [];
    const ts = now();
    const out = [];
    try {
      for (const r of records) {
        const rec = { ...r, id: r.id || newId(), createdAt: r.createdAt || ts, updatedAt: ts };
        place(coll, rec);
        out.push(rec);
      }
    } finally {
      // Records placed before a bad one still show and get saved.
      invalidate(coll);
      notify([coll]);
      scheduleFlush();
    }
    return out;
  }

  function bulkRemove(coll, ids) {
    assertColl(coll);
    let any = false;
    for (const id of ids) any = unplace(coll, id) || any;
    if (!any) return;
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
    detachCache,
    /** Changes whenever a collection's contents change; for memoizing derived data. */
    revision(coll) {
      return revs[coll] || 0;
    },
    /** Physical collections that hold data (for team copy and backups). */
    physicalCollections() {
      return [...data.entries()].filter(([, m]) => m.size).map(([k]) => k);
    },
    physicalRecords(phys) {
      return [...(data.get(phys)?.values() || [])];
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get backendKind() {
      return backend.kind;
    },
  };
}
