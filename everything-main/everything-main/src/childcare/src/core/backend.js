/**
 * Storage backends. The store only talks to this interface:
 *
 *   loadMeta(metaKeys)          -> { [name]: version } for those meta items
 *   loadCollections(names)      -> { [name]: record[] }
 *   loadSettings()              -> object | null
 *   putRecords(name, records)   -> void
 *   deleteRecords(name, ids)    -> void
 *   saveSettings(settings)      -> void
 *   bumpVersions(names)         -> { [name]: version } for the meta items touched
 *   nextNumber(kind, atLeast, count) -> first of `count` reserved numbers, >= atLeast
 *
 * See keys.js for the KV layout. One item per record keeps writes small and
 * lets a collection or partition load with a single prefix query, the access
 * pattern KV is cheapest at.
 */
import { PREFIX, recordKey, recordPrefix, flattenMeta, bumpPlan } from './keys.js';

const BATCH = 100;

/** Run async jobs with a small concurrency cap (KV limits concurrent lists). */
export async function pool(items, limit, fn) {
  const queue = items.map((it, i) => [it, i]);
  const out = new Array(items.length);
  const worker = async () => {
    while (queue.length) {
      const [it, i] = queue.shift();
      out[i] = await fn(it);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createPuterBackend(puter) {
  const kv = puter.kv;

  async function listValues(pattern) {
    const out = [];
    let cursor;
    for (let guard = 0; guard < 1000; guard++) {
      const page = await kv.list({ pattern, returnValues: true, limit: 1000, ...(cursor ? { cursor } : {}) });
      const items = Array.isArray(page) ? page : page?.items || [];
      for (const it of items) if (it && it.value && typeof it.value === 'object') out.push(it.value);
      cursor = Array.isArray(page) ? null : page?.cursor;
      if (!cursor) break;
    }
    return out;
  }

  return {
    kind: 'puter',
    async loadMeta(metaKeys) {
      const values = await pool(metaKeys, 4, (k) => kv.get(k));
      return flattenMeta(Object.fromEntries(metaKeys.map((k, i) => [k, values[i]])));
    },
    async loadCollections(names) {
      const lists = await pool(names, 3, (n) => listValues(recordPrefix(n)));
      return Object.fromEntries(names.map((n, i) => [n, lists[i]]));
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
        await kv.set(records.slice(i, i + BATCH).map((r) => ({ key: recordKey(name, r.id), value: r })));
      }
    },
    async deleteRecords(name, ids) {
      // No batch delete in KV; keep a few in flight to respect rate limits.
      await pool(ids, 3, (id) => kv.del(recordKey(name, id)));
    },
    async saveSettings(settings) {
      await kv.set(`${PREFIX}settings`, settings);
    },
    async bumpVersions(names) {
      const plan = bumpPlan(names);
      const keys = Object.keys(plan);
      const res = await pool(keys, 4, (k) => kv.incr(k, plan[k]));
      return flattenMeta(Object.fromEntries(keys.map((k, i) => [k, res[i] && typeof res[i] === 'object' ? res[i] : {}])));
    },
    async nextNumber(kind, atLeast = 1, count = 1) {
      const read = (res) => Number(typeof res === 'object' ? res?.[kind] : res) || 0;
      // Reserve `count` numbers at once; the result is the last of them.
      let n = read(await kv.incr(`${PREFIX}seq`, { [kind]: count }));
      // Catch the counter up with numbers already used; the increment keeps
      // it atomic if another device does the same at the same time.
      if (n - count + 1 < atLeast) n = read(await kv.incr(`${PREFIX}seq`, { [kind]: atLeast - (n - count + 1) }));
      return n - count + 1;
    },
  };
}

/**
 * In-memory backend for tests and the signed-out demo. Several stores can
 * share one instance to simulate two devices on the same account. It keeps
 * the same meta item layout as KV so tests exercise the real grouping.
 */
export function createMemoryBackend(seed = {}) {
  const data = new Map();
  let settings = seed.settings ? structuredClone(seed.settings) : null;
  const metaItems = new Map(); // metaKey -> { path: version }
  const seq = {};
  const coll = (name) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name);
  };
  for (const [name, records] of Object.entries(seed.collections || {})) {
    for (const r of records) coll(name).set(r.id, structuredClone(r));
  }
  // Seeded data counts as written once, as it would be in KV.
  for (const [k, paths] of Object.entries(bumpPlan(Object.keys(seed.collections || {}).filter((n) => seed.collections[n].length)))) {
    metaItems.set(k, Object.fromEntries(Object.keys(paths).map((p) => [p, 1])));
  }
  let failing = false;
  const guard = () => {
    if (failing) throw Object.assign(new Error('offline'), { code: 'network' });
  };
  const calls = [];
  return {
    kind: 'memory',
    calls,
    setFailing(v) {
      failing = v;
    },
    peek(name) {
      return [...coll(name).values()];
    },
    async loadMeta(metaKeys) {
      guard();
      calls.push(['loadMeta', metaKeys]);
      return flattenMeta(Object.fromEntries(metaKeys.map((k) => [k, metaItems.get(k) || null])));
    },
    async loadCollections(names) {
      guard();
      calls.push(['loadCollections', names]);
      return Object.fromEntries(names.map((n) => [n, [...coll(n).values()].map((r) => structuredClone(r))]));
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
      const plan = bumpPlan(names);
      const out = {};
      for (const [k, paths] of Object.entries(plan)) {
        const cur = metaItems.get(k) || {};
        for (const p of Object.keys(paths)) cur[p] = (cur[p] || 0) + 1;
        metaItems.set(k, cur);
        out[k] = { ...cur };
      }
      return flattenMeta(out);
    },
    async nextNumber(kind, atLeast = 1, count = 1) {
      guard();
      const first = Math.max((seq[kind] || 0) + 1, atLeast);
      seq[kind] = first + count - 1;
      return first;
    },
  };
}
