/**
 * Fakes of the parts of puter.kv and puter.fs the app and the worker use,
 * following the documented semantics: prefix list with pagination and
 * optional values, batch set, and incr with a path map that returns the
 * whole object.
 */
export function fakeKV({ pageSize = 1000 } = {}) {
  const data = new Map();
  const calls = { list: 0, set: 0, get: 0, incr: 0, del: 0 };
  return {
    data,
    calls,
    async get(key) {
      calls.get++;
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async set(key, value) {
      calls.set++;
      if (Array.isArray(key)) for (const it of key) data.set(it.key, structuredClone(it.value));
      else data.set(key, structuredClone(value));
      return true;
    },
    async del(key) {
      calls.del++;
      data.delete(key);
      return true;
    },
    async expire() {
      return true;
    },
    async incr(key, paths = 1) {
      calls.incr++;
      if (typeof paths === 'number') {
        const n = (Number(data.get(key)) || 0) + paths;
        data.set(key, n);
        return n;
      }
      const cur = data.get(key) || {};
      for (const [p, n] of Object.entries(paths)) cur[p] = (cur[p] || 0) + n;
      data.set(key, cur);
      return structuredClone(cur);
    },
    async list({ pattern, returnValues, limit = 1000, cursor }) {
      calls.list++;
      const keys = [...data.keys()].filter((k) => k.startsWith(pattern)).sort();
      const start = cursor ? Number(cursor) : 0;
      const size = Math.min(limit, pageSize);
      const slice = keys.slice(start, start + size);
      const next = start + size < keys.length ? String(start + size) : undefined;
      return { items: slice.map((k) => (returnValues ? { key: k, value: structuredClone(data.get(k)) } : k)), cursor: next };
    },
  };
}

export function fakeFS() {
  const files = new Map();
  return {
    files,
    async write(path, blob) {
      files.set(path, blob);
    },
    async read(path) {
      if (!files.has(path)) throw new Error('not found');
      return files.get(path);
    },
    async delete(path) {
      files.delete(path);
    },
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
