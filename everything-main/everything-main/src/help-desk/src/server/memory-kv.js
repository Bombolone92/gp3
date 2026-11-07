/**
 * An in-memory stand-in for the Puter key-value API, faithful to the parts
 * the help desk uses: batch get and set, path updates, counters, prefix
 * listings with pages, and expiry. Used by the tests and the offline demo.
 */

function clone(v) {
  return v === undefined ? undefined : structuredClone(v);
}

function splitPath(path) {
  const out = [];
  const re = /\[\s*"((?:[^"\\]|\\.)*)"\s*\]|\[(\d+)\]|([^.[\]]+)/g;
  let m;
  while ((m = re.exec(path))) out.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : m[3]));
  return out;
}

function setPath(root, path, value) {
  const parts = splitPath(path);
  if (!parts.length) return value;
  let obj = root && typeof root === 'object' ? root : {};
  const top = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (obj[p] === null || typeof obj[p] !== 'object') {
      if (obj[p] !== undefined && obj[p] !== null) {
        const err = new Error('invalid_path');
        err.code = 'invalid_path';
        throw err;
      }
      obj[p] = {};
    }
    obj = obj[p];
  }
  obj[parts[parts.length - 1]] = value;
  return top;
}

function getPath(root, path) {
  let obj = root;
  for (const p of splitPath(path)) {
    if (obj === null || obj === undefined) return undefined;
    obj = obj[p];
  }
  return obj;
}

function removePath(root, path) {
  const parts = splitPath(path);
  let obj = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj || typeof obj !== 'object') return;
    obj = obj[parts[i]];
  }
  if (obj && typeof obj === 'object') delete obj[parts[parts.length - 1]];
}

export class MemoryKV {
  constructor({ now = () => Date.now(), persist = null } = {}) {
    this.map = new Map();
    this.now = now;
    this.persist = persist;
    this.calls = { get: 0, set: 0, list: 0, update: 0, incr: 0, del: 0 };
  }

  live(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expireAt && e.expireAt * 1000 <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  save() {
    this.persist?.(this);
  }

  async get(key) {
    this.calls.get++;
    if (Array.isArray(key)) return key.map((k) => clone(this.live(k)?.value) ?? null);
    return clone(this.live(key)?.value) ?? null;
  }

  async set(key, value, expireAt) {
    this.calls.set++;
    const items = Array.isArray(key) ? key : key && typeof key === 'object' && !Array.isArray(key) ? (key.items || [key]) : [{ key, value, expireAt }];
    for (const it of items) {
      if (typeof it.key !== 'string' || !it.key) throw Object.assign(new Error('key_undefined'), { code: 'key_undefined' });
      const size = JSON.stringify(it.value ?? null).length;
      if (size > 400 * 1024) throw Object.assign(new Error('value_too_large'), { code: 'value_too_large' });
      this.map.set(it.key, { value: clone(it.value), expireAt: Number(it.expireAt) || 0 });
    }
    this.save();
    return true;
  }

  async update(key, paths, ttl) {
    this.calls.update++;
    const e = this.live(key);
    let value = e ? e.value : {};
    for (const [p, v] of Object.entries(paths)) value = setPath(value, p, clone(v));
    const expireAt = ttl === null ? 0 : typeof ttl === 'number' ? Math.floor(this.now() / 1000) + ttl : e?.expireAt || 0;
    this.map.set(key, { value, expireAt });
    this.save();
    return clone(value);
  }

  async incr(key, amount = 1) {
    this.calls.incr++;
    const e = this.live(key);
    if (typeof amount === 'number') {
      const cur = e ? e.value : 0;
      if (typeof cur !== 'number') throw Object.assign(new Error('value_not_a_number'), { code: 'value_not_a_number' });
      const next = cur + amount;
      this.map.set(key, { value: next, expireAt: e?.expireAt || 0 });
      this.save();
      return next;
    }
    let value = e ? e.value : {};
    for (const [p, n] of Object.entries(amount)) {
      const cur = getPath(value, p) ?? 0;
      if (typeof cur !== 'number') throw Object.assign(new Error('value_not_a_number'), { code: 'value_not_a_number' });
      value = setPath(value, p, cur + n);
    }
    this.map.set(key, { value, expireAt: e?.expireAt || 0 });
    this.save();
    return clone(value);
  }

  async decr(key, amount = 1) {
    return this.incr(key, typeof amount === 'number' ? -amount : Object.fromEntries(Object.entries(amount).map(([k, v]) => [k, -v])));
  }

  async add(key, value) {
    const e = this.live(key);
    const cur = e ? e.value : [];
    if (!Array.isArray(cur)) throw Object.assign(new Error('value_not_a_list'), { code: 'value_not_a_list' });
    const next = cur.concat(Array.isArray(value) ? clone(value) : [clone(value)]);
    this.map.set(key, { value: next, expireAt: e?.expireAt || 0 });
    this.save();
    return clone(next);
  }

  async remove(key, ...paths) {
    const e = this.live(key);
    if (!e) return null;
    for (const p of paths.flat()) removePath(e.value, p);
    this.save();
    return clone(e.value);
  }

  async del(key) {
    this.calls.del++;
    this.map.delete(key);
    this.save();
    return true;
  }

  async expire(key, seconds) {
    const e = this.live(key);
    if (e) e.expireAt = Math.floor(this.now() / 1000) + seconds;
    this.save();
    return true;
  }

  async expireAt(key, ts) {
    const e = this.live(key);
    if (e) e.expireAt = ts;
    this.save();
    return true;
  }

  async flush() {
    this.map.clear();
    this.save();
    return true;
  }

  async list(a, b) {
    this.calls.list++;
    let opts;
    if (a && typeof a === 'object') opts = a;
    else if (typeof a === 'boolean') opts = { returnValues: a };
    else opts = { pattern: a, returnValues: !!b };
    const prefix = String(opts.pattern ?? '*').replace(/\*$/, '');
    let keys = [...this.map.keys()].filter((k) => k.startsWith(prefix) && this.live(k)).sort();
    if (opts.reverse) keys.reverse();
    const paged = opts.limit !== undefined || opts.cursor !== undefined || opts.offset !== undefined || opts.includeTotal;
    const start = opts.cursor ? Number(opts.cursor) : opts.offset || 0;
    const limit = Math.min(1000, opts.limit || 1000);
    const slice = paged ? keys.slice(start, start + limit) : keys;
    const items = slice.map((k) => (opts.returnValues ? { key: k, value: clone(this.map.get(k).value) } : k));
    if (!paged) return items;
    const next = start + limit < keys.length ? String(start + limit) : null;
    const page = { items, cursor: next };
    if (opts.includeTotal) page.total = keys.length;
    return page;
  }

  /** Serializable snapshot (for the offline demo's localStorage). */
  dump() {
    return [...this.map.entries()];
  }

  load(entries) {
    this.map = new Map(entries);
  }
}
