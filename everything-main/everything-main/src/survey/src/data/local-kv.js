/**
 * A puter.kv look-alike over a plain Map, persisted to localStorage when one
 * is given. Backs the local demo mode (no Puter account) and the tests. It
 * implements the subset of puter.kv this app uses, with the same semantics:
 * prefix patterns, cursor paging, reverse order, incr/decr, dotted update
 * paths.
 */
function globPrefix(pattern) {
  if (pattern == null || pattern === '*') return '';
  return String(pattern).replace(/\*$/, '');
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function createLocalKv({ storage = null, namespace = 'sv-local-kv:' } = {}) {
  const map = new Map();
  if (storage) {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(namespace)) {
        try {
          map.set(k.slice(namespace.length), JSON.parse(storage.getItem(k)));
        } catch {
          /* skip corrupt entry */
        }
      }
    }
  }
  // Write `key` through to storage. When storage is full the change is
  // undone in memory too and the call fails, as a full store would: reads
  // go back to storage (another tab may have written), so a value kept
  // only in memory would vanish on the next read while its write had
  // reported success.
  const persist = (key, had, prev) => {
    if (!storage) return;
    try {
      if (map.has(key)) storage.setItem(namespace + key, JSON.stringify(map.get(key)));
      else storage.removeItem(namespace + key);
    } catch (err) {
      if (had) map.set(key, prev);
      else map.delete(key);
      throw Object.assign(new Error('Browser storage is full'), { code: 'storage_full', cause: err });
    }
  };
  // Change `key` with `fn`, then write it through.
  const change = (key, fn) => {
    const had = map.has(key);
    const prev = map.get(key);
    const out = fn();
    persist(key, had, prev);
    return out;
  };
  // Another tab of the local demo (the respondent page) may have written.
  const refresh = (key) => {
    if (!storage) return;
    const raw = storage.getItem(namespace + key);
    if (raw == null) map.delete(key);
    else {
      try {
        map.set(key, JSON.parse(raw));
      } catch {
        /* keep memory copy */
      }
    }
  };
  const refreshAll = () => {
    if (!storage) return;
    const seen = new Set();
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(namespace)) {
        seen.add(k.slice(namespace.length));
        refresh(k.slice(namespace.length));
      }
    }
    for (const k of [...map.keys()]) if (!seen.has(k)) map.delete(k);
  };

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  return {
    map,
    async get(key) {
      refresh(key);
      return map.has(key) ? clone(map.get(key)) : null;
    },
    async set(key, value) {
      change(key, () => map.set(key, clone(value)));
      return true;
    },
    async del(key) {
      change(key, () => map.delete(key));
      return true;
    },
    async incr(key, by = 1) {
      refresh(key);
      const next = (Number(map.get(key)) || 0) + by;
      change(key, () => map.set(key, next));
      return next;
    },
    // Expiry is not simulated: nothing in local mode runs long enough.
    async expire() {
      return true;
    },
    async decr(key, by = 1) {
      return this.incr(key, -by);
    },
    async update(key, patch) {
      refresh(key);
      const cur = map.get(key);
      const obj = cur && typeof cur === 'object' ? clone(cur) : {};
      for (const [path, value] of Object.entries(patch || {})) setPath(obj, path, clone(value));
      change(key, () => map.set(key, obj));
      return clone(obj);
    },
    async remove(key, ...paths) {
      refresh(key);
      const obj = clone(map.get(key));
      if (!obj || typeof obj !== 'object') return null;
      for (const path of paths.flat()) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1 && cur; i++) cur = cur[parts[i]];
        if (cur) delete cur[parts[parts.length - 1]];
      }
      change(key, () => map.set(key, obj));
      return clone(obj);
    },
    async list(a, b) {
      refreshAll();
      const opts = a && typeof a === 'object' ? a : { pattern: typeof a === 'string' ? a : undefined, returnValues: typeof a === 'boolean' ? a : b };
      const prefix = globPrefix(opts.pattern);
      let keys = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (opts.reverse) keys.reverse();
      const shape = (k) => (opts.returnValues ? { key: k, value: clone(map.get(k)) } : k);
      const paged = opts.limit != null || opts.cursor != null;
      if (!paged) return keys.map(shape);
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const limit = Math.min(1000, opts.limit || 1000);
      const slice = keys.slice(start, start + limit);
      const next = start + limit < keys.length ? String(start + limit) : undefined;
      return { items: slice.map(shape), cursor: next };
    },
  };
}
