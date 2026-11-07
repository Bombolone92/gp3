/**
 * An in-memory stand-in for puter.kv with the semantics the app relies on:
 * prefix list() with cursor pages, batch set() with per-item expireAt,
 * atomic incr(), and values that come back as copies. Used by the tests and
 * by the dev mock page; it also counts calls so tests can assert on cost.
 */
export function createMemoryKV({ now = () => Date.now() } = {}) {
  const data = new Map(); // key -> { value, expireAt }
  const calls = { get: 0, set: 0, del: 0, incr: 0, list: 0 };
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  const alive = (e) => e && (!e.expireAt || e.expireAt * 1000 > now());

  function setOne(key, value, expireAt) {
    if (typeof key !== 'string' || !key) throw Object.assign(new Error('key_undefined'), { code: 'key_undefined' });
    data.set(key, { value: clone(value), expireAt: expireAt || null });
  }

  const kv = {
    calls,
    data,
    async get(key) {
      calls.get++;
      const e = data.get(key);
      return alive(e) ? clone(e.value) : null;
    },
    async set(key, value, expireAt) {
      calls.set++;
      if (Array.isArray(key)) {
        if (key.length > 1000) throw Object.assign(new Error('bad_request'), { code: 'bad_request' });
        for (const item of key) setOne(item.key, item.value, item.expireAt);
        return true;
      }
      if (key && typeof key === 'object') {
        if (Array.isArray(key.items)) return kv.set(key.items);
        setOne(key.key, key.value, key.expireAt);
        return true;
      }
      setOne(key, value, typeof expireAt === 'number' ? expireAt : null);
      return true;
    },
    async del(...keys) {
      calls.del++;
      for (const k of keys.flat()) data.delete(k);
      return true;
    },
    async incr(key, amount = 1) {
      calls.incr++;
      const e = data.get(key);
      const cur = alive(e) && typeof e.value === 'number' ? e.value : 0;
      const next = cur + (typeof amount === 'number' ? amount : 1);
      data.set(key, { value: next, expireAt: e?.expireAt || null });
      return next;
    },
    async update(key, paths) {
      calls.set++;
      const e = data.get(key);
      const value = alive(e) && e.value && typeof e.value === 'object' ? e.value : {};
      for (const [p, v] of Object.entries(paths)) {
        const parts = p.split('.');
        let o = value;
        for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
        o[parts[parts.length - 1]] = clone(v);
      }
      data.set(key, { value, expireAt: e?.expireAt || null });
      return clone(value);
    },
    async list(a, b) {
      calls.list++;
      let opts = {};
      if (typeof a === 'string') opts = { pattern: a, returnValues: !!b };
      else if (typeof a === 'boolean') opts = { returnValues: a };
      else if (a && typeof a === 'object') opts = a;
      const prefix = (opts.pattern || '*').replace(/\*$/, '');
      let keys = [...data.keys()].filter((k) => k.startsWith(prefix) && alive(data.get(k))).sort();
      if (opts.reverse) keys.reverse();
      const paged = opts.limit !== undefined || opts.cursor !== undefined;
      const start = opts.cursor ? Number(opts.cursor) : opts.offset || 0;
      const limit = Math.min(opts.limit || 1000, 1000);
      const slice = paged ? keys.slice(start, start + limit) : keys;
      const items = slice.map((k) => (opts.returnValues ? { key: k, value: clone(data.get(k).value) } : k));
      if (!paged) return items;
      const next = start + limit < keys.length ? String(start + limit) : undefined;
      return { items, cursor: next, total: opts.includeTotal ? keys.length : undefined };
    },
    async flush() {
      data.clear();
      return true;
    },
  };
  return kv;
}
