/**
 * Storage backends. The store only talks to this interface:
 *
 *   loadMeta()                 -> { [collection]: version }
 *   loadCollection(name)       -> record[]
 *   loadSettings()             -> object | null
 *   putRecords(name, records)  -> void
 *   deleteRecords(name, ids)   -> void
 *   saveSettings(settings)     -> void
 *   bumpVersions(names)        -> { [collection]: version } (whole map)
 *   nextNumber(kind, atLeast)  -> integer, atomically increasing, >= atLeast
 *
 * Puter KV layout (one item per record keeps writes small and lets a whole
 * collection load with a single prefix query, the access pattern KV is
 * cheapest at):
 *
 *   pm1:r:<collection>:<id>   one record; the ledger uses monthly
 *                             collections (pm1:r:tx.2026-10:<id>)
 *   pm1:settings              company settings
 *   pm1:meta                  { collection: version } bumped with incr
 *   pm1:seq                   { lease: n, workOrder: n, task: n }
 */

import { physicalName } from './store.js';

export const PREFIX = 'pm1:';
const recordKey = (name, id) => `${PREFIX}r:${name}:${id}`;
const BATCH = 100;

/**
 * The kv.incr path for a version field. KV reads dots in a path as nesting,
 * so a ledger month ('tx.2026-10') is quoted to stay one top-level field.
 */
export const metaPath = (name) => (/^[A-Za-z0-9_]+$/.test(name) ? name : `[${JSON.stringify(name)}]`);

export function metaPaths(names) {
  const paths = {};
  for (const n of names) paths[metaPath(n)] = 1;
  return paths;
}

/**
 * pm1:meta as { name: version }. Earlier builds bumped ledger months as
 * dotted paths, which KV stored nested ({ tx: { '2026-10': 3 } }); those
 * counts are added to the quoted field's, so each version keeps rising
 * from where it was and the "+1" check for other writers still holds.
 */
export function readMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  const add = (k, v) => {
    if (Number.isFinite(v)) out[k] = (out[k] || 0) + v;
  };
  for (const [k, v] of Object.entries(meta)) {
    if (v && typeof v === 'object') for (const [sub, n] of Object.entries(v)) add(`${k}.${sub}`, n);
    else add(k, v);
  }
  return out;
}

export function createPuterBackend(puter) {
  const kv = puter.kv;
  return {
    kind: 'puter',
    async loadMeta() {
      return readMeta(await kv.get(`${PREFIX}meta`));
    },
    async loadCollection(name) {
      const out = [];
      let cursor;
      const pattern = `${PREFIX}r:${name}:`;
      for (let guard = 0; guard < 1000; guard++) {
        const page = await kv.list({ pattern, returnValues: true, limit: 1000, ...(cursor ? { cursor } : {}) });
        const items = Array.isArray(page) ? page : page?.items || [];
        for (const it of items) if (it && it.value && typeof it.value === 'object') out.push(it.value);
        cursor = Array.isArray(page) ? null : page?.cursor;
        if (!cursor) break;
      }
      return out;
    },
    async loadSettings() {
      return (await kv.get(`${PREFIX}settings`)) || null;
    },
    async putRecords(name, records) {
      if (records.length === 1) {
        await kv.set(recordKey(name, records[0].id), records[0]);
        return;
      }
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH).map((r) => ({ key: recordKey(name, r.id), value: r }));
        await kv.set(chunk);
      }
    },
    async deleteRecords(name, ids) {
      // No batch delete in KV; keep a few in flight to respect rate limits.
      const queue = [...ids];
      const worker = async () => {
        while (queue.length) await kv.del(recordKey(name, queue.shift()));
      };
      await Promise.all([worker(), worker(), worker()]);
    },
    async saveSettings(settings) {
      await kv.set(`${PREFIX}settings`, settings);
    },
    async bumpVersions(names) {
      return readMeta(await kv.incr(`${PREFIX}meta`, metaPaths(names)));
    },
    async nextNumber(kind, atLeast = 1) {
      const read = (res) => Number(typeof res === 'object' ? res?.[kind] : res) || 0;
      let n = read(await kv.incr(`${PREFIX}seq`, { [kind]: 1 }));
      // Catch the counter up with numbers already used; the increment keeps
      // it atomic if another device does the same at the same time.
      if (n < atLeast) n = read(await kv.incr(`${PREFIX}seq`, { [kind]: atLeast - n }));
      return n;
    },
  };
}

/**
 * In-memory backend for tests and the signed-out demo. Several stores can
 * share one instance to simulate two devices on the same account.
 */
export function createMemoryBackend(seed = {}) {
  const data = new Map();
  let settings = seed.settings ? structuredClone(seed.settings) : null;
  const meta = {};
  const seq = {};
  // Seeds use logical names; ledger records land in their monthly partition.
  for (const [name, records] of Object.entries(seed.collections || {})) {
    for (const r of records) {
      const phys = physicalName(name, r);
      if (!data.has(phys)) data.set(phys, new Map());
      data.get(phys).set(r.id, structuredClone(r));
      meta[phys] = 1;
    }
  }
  if (seed.settings) meta.settings = 1;
  const coll = (name) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name);
  };
  let failing = false;
  const guard = () => {
    if (failing) throw Object.assign(new Error('offline'), { code: 'network' });
  };
  return {
    kind: 'memory',
    setFailing(v) {
      failing = v;
    },
    peek(name) {
      return [...coll(name).values()];
    },
    async loadMeta() {
      guard();
      return { ...meta };
    },
    async loadCollection(name) {
      guard();
      return [...coll(name).values()].map((r) => structuredClone(r));
    },
    async loadSettings() {
      guard();
      return settings ? structuredClone(settings) : null;
    },
    async putRecords(name, records) {
      guard();
      for (const r of records) coll(name).set(r.id, structuredClone(r));
    },
    async deleteRecords(name, ids) {
      guard();
      for (const id of ids) coll(name).delete(id);
    },
    async saveSettings(s) {
      guard();
      settings = structuredClone(s);
    },
    async bumpVersions(names) {
      guard();
      for (const n of names) meta[n] = (meta[n] || 0) + 1;
      return { ...meta };
    },
    async nextNumber(kind, atLeast = 1) {
      guard();
      seq[kind] = Math.max((seq[kind] || 0) + 1, atLeast);
      return seq[kind];
    },
  };
}
