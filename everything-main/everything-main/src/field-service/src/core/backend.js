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
 *   fs1:r:<collection>:<id>   one record
 *   fs1:settings              business settings
 *   fs1:meta                  { collection: version } bumped with incr
 *   fs1:seq                   { quote: n, job: n, invoice: n, request: n }
 */

export const PREFIX = 'fs1:';
const recordKey = (name, id) => `${PREFIX}r:${name}:${id}`;
const BATCH = 100;

export function createPuterBackend(puter) {
  const kv = puter.kv;
  return {
    kind: 'puter',
    async loadMeta() {
      return (await kv.get(`${PREFIX}meta`)) || {};
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
      const paths = {};
      for (const n of names) paths[n] = 1;
      const res = await kv.incr(`${PREFIX}meta`, paths);
      return res && typeof res === 'object' ? res : {};
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
  for (const [name, records] of Object.entries(seed.collections || {})) {
    const m = new Map();
    for (const r of records) m.set(r.id, structuredClone(r));
    data.set(name, m);
  }
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
