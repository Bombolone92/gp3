/**
 * Storage backends. The store only talks to this interface:
 *
 *   loadMeta()                  -> { [bucket]: version }
 *   loadBucket(bucket)          -> record[]
 *   loadSettings()              -> object | null
 *   putRecords(bucket, records) -> void
 *   deleteRecords(bucket, ids)  -> void
 *   saveSettings(settings)      -> void
 *   bumpVersions(buckets)       -> { [bucket]: version } (whole map)
 *   nextNumber(kind, atLeast)   -> integer, atomically increasing, >= atLeast
 *
 * Puter KV layout. KV is backed by DynamoDB, so every read is a key lookup
 * or a prefix query, never a scan, and every write touches one small item:
 *
 *   fl1:r:<bucket>:<id>   one record (bucket = `vehicles` or `fuel_202610`)
 *   fl1:settings          fleet settings
 *   fl1:meta              { bucket: version } bumped with an atomic incr
 *   fl1:seq               { issue: n, workOrder: n, purchaseOrder: n }
 */

export const PREFIX = 'fl1:';
const recordKey = (bucket, id) => `${PREFIX}r:${bucket}:${id}`;
const BATCH = 100;

export function createPuterBackend(puter) {
  const kv = puter.kv;
  return {
    kind: 'puter',
    async loadMeta() {
      return (await kv.get(`${PREFIX}meta`)) || {};
    },
    async loadBucket(bucket) {
      const out = [];
      let cursor;
      // The trailing colon keeps `fuel` from matching `fuel_202610`.
      const pattern = `${PREFIX}r:${bucket}:`;
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
    async putRecords(bucket, records) {
      if (records.length === 1) {
        await kv.set(recordKey(bucket, records[0].id), records[0]);
        return;
      }
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH).map((r) => ({ key: recordKey(bucket, r.id), value: r }));
        await kv.set(chunk);
      }
    },
    async deleteRecords(bucket, ids) {
      // No batch delete in KV; keep a few in flight to respect rate limits.
      const queue = [...ids];
      const worker = async () => {
        while (queue.length) await kv.del(recordKey(bucket, queue.shift()));
      };
      await Promise.all([worker(), worker(), worker()]);
    },
    async saveSettings(settings) {
      await kv.set(`${PREFIX}settings`, settings);
    },
    async bumpVersions(buckets) {
      const paths = {};
      for (const n of buckets) paths[n] = 1;
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
 * share one instance to simulate two devices on the same account. Seed
 * records are given per collection and placed into buckets here.
 */
export function createMemoryBackend(seed = {}, { bucketOf = (c) => c } = {}) {
  const data = new Map(); // bucket -> Map(id -> record)
  let settings = seed.settings ? structuredClone(seed.settings) : null;
  const meta = {};
  const seq = {};
  const bucket = (name) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name);
  };
  for (const [coll, records] of Object.entries(seed.collections || {})) {
    for (const r of records) {
      const b = bucketOf(coll, r);
      bucket(b).set(r.id, structuredClone(r));
      meta[b] = 1;
    }
  }
  if (settings) meta.settings = 1;
  let failing = false;
  const calls = [];
  const guard = (op, arg) => {
    calls.push([op, arg]);
    if (failing) throw Object.assign(new Error('offline'), { code: 'network' });
  };
  return {
    kind: 'memory',
    calls,
    setFailing(v) {
      failing = v;
    },
    peek(name) {
      return [...bucket(name).values()];
    },
    buckets() {
      return [...data.keys()].filter((k) => data.get(k).size);
    },
    async loadMeta() {
      guard('loadMeta');
      return { ...meta };
    },
    async loadBucket(name) {
      guard('loadBucket', name);
      return [...bucket(name).values()].map((r) => structuredClone(r));
    },
    async loadSettings() {
      guard('loadSettings');
      return settings ? structuredClone(settings) : null;
    },
    async putRecords(name, records) {
      guard('putRecords', name);
      for (const r of records) bucket(name).set(r.id, structuredClone(r));
    },
    async deleteRecords(name, ids) {
      guard('deleteRecords', name);
      for (const id of ids) bucket(name).delete(id);
    },
    async saveSettings(s) {
      guard('saveSettings');
      settings = structuredClone(s);
    },
    async bumpVersions(names) {
      guard('bumpVersions', names);
      for (const n of names) meta[n] = (meta[n] || 0) + 1;
      return { ...meta };
    },
    async nextNumber(kind, atLeast = 1) {
      guard('nextNumber', kind);
      seq[kind] = Math.max((seq[kind] || 0) + 1, atLeast);
      return seq[kind];
    },
  };
}
