/**
 * Key-value helpers for the backend. They wrap the Puter KV API the backend
 * is handed (the worker owner's `me.puter.kv`, or the signed-in user's
 * `puter.kv` when the desk runs in the browser) with the access patterns the
 * help desk needs: batched reads, paged prefix scans, and the commit that
 * writes records together with a numbered change feed entry.
 */
import { CHANGE_TTL_SECONDS } from '../shared/keys.js';

const GET_BATCH = 100;

/**
 * Listings always stay inside one desk. A missing or empty prefix would list
 * the owner's whole store, every desk and invite included.
 */
function checkPrefix(prefix) {
  if (typeof prefix !== 'string' || !/^hd:[^:*]+:/.test(prefix)) throw new Error('A listing needs a desk key prefix');
}

export class Store {
  constructor(kv, now = () => Date.now()) {
    this.kv = kv;
    this.now = now;
    this.batchGet = true;
  }

  get(key) {
    return this.kv.get(key);
  }

  /** Read many keys, answering values in the same order (null when absent). */
  async getMany(keys) {
    if (!keys.length) return [];
    if (keys.length === 1) return [await this.kv.get(keys[0])];
    const out = [];
    for (let i = 0; i < keys.length; i += GET_BATCH) {
      const slice = keys.slice(i, i + GET_BATCH);
      if (this.batchGet) {
        try {
          const res = await this.kv.get(slice);
          if (Array.isArray(res) && res.length === slice.length) {
            out.push(...res.map((v) => (v === undefined ? null : v)));
            continue;
          }
          this.batchGet = false;
        } catch (e) {
          if (e?.code !== 'key_too_large' && e?.code !== 'bad_request') throw e;
          this.batchGet = false;
        }
      }
      out.push(...(await Promise.all(slice.map((k) => this.kv.get(k)))));
    }
    return out;
  }

  /** One page of a prefix listing with values. */
  async page(prefix, { limit = 500, cursor, reverse = false } = {}) {
    checkPrefix(prefix);
    const opts = { pattern: prefix, returnValues: true, limit };
    if (cursor) opts.cursor = cursor;
    if (reverse) opts.reverse = true;
    const res = await this.kv.list(opts);
    if (Array.isArray(res)) return { items: res, cursor: null };
    return { items: res?.items || [], cursor: res?.cursor || null };
  }

  /** Every entry under a prefix, a page at a time, up to `max`. */
  async all(prefix, { max = 5000 } = {}) {
    const out = [];
    let cursor;
    do {
      const page = await this.page(prefix, { limit: Math.min(1000, max - out.length), cursor });
      out.push(...page.items);
      cursor = page.cursor;
    } while (cursor && out.length < max);
    return out;
  }

  async keysUnder(prefix, { max = 10000 } = {}) {
    checkPrefix(prefix);
    const out = [];
    let cursor;
    do {
      const opts = { pattern: prefix, limit: 1000 };
      if (cursor) opts.cursor = cursor;
      const res = await this.kv.list(opts);
      const items = Array.isArray(res) ? res : res?.items || [];
      for (const it of items) out.push(typeof it === 'string' ? it : it.key);
      cursor = Array.isArray(res) ? null : res?.cursor;
    } while (cursor && out.length < max);
    return out;
  }

  set(key, value, expireAt) {
    return expireAt ? this.kv.set(key, value, expireAt) : this.kv.set(key, value);
  }

  setMany(items) {
    if (!items.length) return Promise.resolve(true);
    if (items.length === 1) {
      const it = items[0];
      return this.set(it.key, it.value, it.expireAt);
    }
    return this.kv.set(items);
  }

  update(key, paths) {
    return this.kv.update(key, paths);
  }

  incr(key, amount = 1) {
    return this.kv.incr(key, amount);
  }

  /** Remove paths (like `a` or `a.b`) inside a stored object, leaving the rest alone. */
  async remove(key, ...paths) {
    if (typeof this.kv.remove === 'function') return this.kv.remove(key, ...paths);
    // A store without path removal: rewrite the object without them.
    const value = structuredClone((await this.kv.get(key)) || {});
    for (const p of paths) {
      const parts = p.split('.');
      const last = parts.pop();
      const parent = parts.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), value);
      if (parent && typeof parent === 'object') delete parent[last];
    }
    await this.kv.set(key, value);
    return value;
  }

  del(key) {
    return this.kv.del(key);
  }

  async delMany(keys) {
    for (let i = 0; i < keys.length; i += 20) {
      await Promise.all(keys.slice(i, i + 20).map((k) => this.kv.del(k)));
    }
  }

  /**
   * Write records and the change feed entry that announces them. The revision
   * is taken first so the entry and the records go out in one batch; a reader
   * that finds a revision with no entry yet waits for it (see sync).
   *
   * `change` may be a function, called once the revision is taken: an entry
   * that reads a shared record then holds every write announced at or below
   * its revision, so the highest revision is always the most complete.
   */
  async commit(keys, records, change) {
    const rev = await this.kv.incr(keys.rev);
    const at = this.now();
    const items = [...records];
    if (typeof change === 'function') change = await change();
    if (change) {
      items.push({
        key: keys.change(rev),
        value: { ...change, r: rev, at },
        expireAt: Math.floor(at / 1000) + CHANGE_TTL_SECONDS,
      });
    }
    await this.setMany(items);
    return rev;
  }

  /** Count `amount` actions against a limit inside a time window. True when allowed. */
  async allow(key, limit, windowSeconds, amount = 1) {
    // The window is part of the key, so a counter whose expiry failed to
    // set still stops counting when its window ends.
    const window = Math.floor(this.now() / 1000 / windowSeconds);
    const k = `${key}:${window}`;
    const n = await this.kv.incr(k, amount);
    if (n === amount) {
      try {
        await this.kv.expire(k, windowSeconds * 2);
      } catch {
        /* the next window uses a new key anyway */
      }
    }
    return n <= limit;
  }
}
