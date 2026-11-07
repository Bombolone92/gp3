/**
 * Keeps the books in the user's Puter KV store and a copy on the device.
 *
 * Cost model. Puter KV is DynamoDB underneath: reads are billed per 4 KB of
 * each entry touched, writes per 1 KB, list() has a lower rate limit than
 * get/set, and there are no secondary indexes. So:
 *
 *  - One small entry per record (`t:<id>` for a transaction, `c:<id>` for a
 *    contact, ...). Editing an invoice rewrites about 1 KB, never a shard.
 *  - No index keys. Everything a user has fits comfortably in memory, so the
 *    app loads the books once, keeps them in IndexedDB, and answers every
 *    query (lists, search, reports) locally from the typed-array ledger.
 *  - A change log for incremental sync. Each save increments a `rev` counter
 *    and writes `log:<rev>` = { keys } (expiring after 30 days) in the same
 *    batch as the records. A device that already has the books reads `rev`
 *    (one tiny get); if it moved, it reads only the log entries it missed and
 *    only the keys they name. Opening the app with nothing new costs one read.
 *  - An outbox. Writes land in IndexedDB first and are sent in batches, so a
 *    flaky connection never loses an edit and ten quick edits cost one batch.
 *
 * Files (attachments, backups, statement imports) never go to KV; they live
 * in the user's Puter drive.
 */

const LOG_TTL_DAYS = 30;
const DAY = 86400 * 1000;
// A device last known to be current longer ago than this may need log
// entries that have already expired (a day short of the TTL, for clock skew
// between devices). When one is missing it reloads everything instead.
const LOG_KEEP = (LOG_TTL_DAYS - 1) * DAY;
const MAX_LOG_GAP = 500;
// Log entries a writer has reserved (incremented rev) but not written yet
// are rechecked on later pulls for this long, then given up on: a batch that
// never landed has nothing to fetch.
const GAP_TTL = 10 * 60 * 1000;
// After a full load, the newest revs are rechecked once, in case a writer's
// batch was still in flight while the records were being listed.
const RECHECK = 8;
const BATCH = 100;
const CONCURRENCY = 8;

export function logKey(rev) {
  return `log:${String(rev).padStart(12, '0')}`;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function isNetworkError(err) {
  const code = err?.code || err?.error?.code;
  if (code === 'too_many_requests' || code === 'request_timeout' || code === 'response_timeout') return true;
  if (err instanceof TypeError) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export class Sync {
  /**
   * @param {object} opts
   * @param {object} opts.kv        puter.kv (or a compatible mock)
   * @param {object} opts.cache     from openCache()
   * @param {string[]} opts.prefixes record key prefixes to load, e.g. ['a', 't']
   * @param {string[]} opts.singles  standalone keys to load, e.g. ['settings']
   * @param {object} [opts.locks]    a Web Locks LockManager (navigator.locks); null to do without
   * @param {string} [opts.lockPrefix] names this device cache's locks, e.g. its database name
   */
  constructor({ kv, cache, prefixes, singles = [], now = () => Date.now(), flushDelay = 400, locks = globalThis.navigator?.locks, lockPrefix = 'bookkeeping' }) {
    this.kv = kv;
    this.cache = cache;
    this.prefixes = prefixes;
    this.singles = singles;
    this.now = now;
    this.flushDelay = flushDelay;
    this.rev = 0;
    this.client = Math.random().toString(36).slice(2, 10);
    this.outbox = new Map(); // key -> { value, deleted, seq, token }
    this.seq = 0;
    // Tabs share one device cache, outbox included. Each tab holds a lock
    // while it is open, and only takes over outbox entries written by a tab
    // that has closed: sending a live tab's entry could overwrite that tab's
    // newer edit with an older one.
    this.locks = locks?.request && locks?.query ? locks : null;
    this.lockPrefix = lockPrefix;
    this.status = 'idle';
    this.listeners = new Set();
    this.timer = null;
    this.flushing = null;
    this.gaps = new Map(); // rev -> first time it was found missing
    this.syncedAt = 0; // when this device last knew it had every change up to `rev`
    this.reachedCloud = false;
    this.reservedRev = null;
    this.retryDelay = 1000;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(event, detail) {
    for (const fn of this.listeners) fn(event, detail);
  }

  _setStatus(status, error) {
    if (this.status === status && !error) return;
    this.status = status;
    this._emit('status', { status, pending: this.outbox.size, error });
  }

  get pending() {
    return this.outbox.size;
  }

  /**
   * Whether this device has heard from the cloud since it opened and has no
   * log entries still outstanding: work that must not be done twice (such as
   * creating scheduled recurring transactions) waits for this.
   */
  get caughtUp() {
    return this.reachedCloud && !this.gaps.size;
  }

  /**
   * Load the books. From the device cache when there is one (instant, and the
   * caller should then pull()), otherwise from the cloud.
   * Returns { records: Map, fromCache }.
   */
  async start(onProgress) {
    await this._holdTabLock();
    const [cached, outbox, meta] = await Promise.all([
      this.cache.getAll('records'),
      this.cache.getAll('outbox'),
      this.cache.get('meta', 'state'),
    ]);
    await this._adopt(outbox, true);
    if (meta && cached.length) {
      this.rev = meta.rev || 0;
      this.gaps = new Map(meta.gaps || []);
      this.syncedAt = meta.syncedAt ?? meta.at ?? 0;
      this.savedSyncedAt = this.syncedAt;
      const records = new Map(cached);
      this._overlayOutbox(records);
      if (this.outbox.size) this._schedule(0);
      return { records, fromCache: true };
    }
    const records = await this.fullLoad(onProgress);
    if (this.outbox.size) this._schedule(0);
    return { records, fromCache: false };
  }

  _tabLock(client) {
    return `${this.lockPrefix}:tab:${client}`;
  }

  /** Hold this tab's lock until it closes (or close() is called). */
  _holdTabLock() {
    if (!this.locks || this.releaseTab) return undefined;
    return new Promise((held) => {
      this.locks.request(this._tabLock(this.client), () => {
        held();
        return new Promise((release) => { this.releaseTab = release; });
      }).catch(() => held());
    });
  }

  /** Let go of this tab's lock, as closing the tab does. */
  close() {
    clearTimeout(this.timer);
    this.releaseTab?.();
    this.releaseTab = null;
  }

  /**
   * Take over outbox entries from the device cache that no open tab is
   * sending. Without Web Locks there is no telling, so this happens only
   * at start (the old behavior). Each entry is claimed in one IndexedDB
   * transaction, and only if it is unchanged since it was read, so two
   * tabs never both take the same one. Returns the entries taken over, as
   * [[key, value|undefined]].
   */
  async _adopt(persisted, starting = false) {
    if (!this.locks && !starting) return [];
    let alive = null;
    if (this.locks) {
      try {
        const { held = [] } = await this.locks.query();
        alive = new Set(held.map((l) => l.name));
      } catch {}
    }
    const seen = new Map();
    for (const [k, v] of persisted) {
      if (!v || this.outbox.has(k)) continue;
      if (alive && v.owner && alive.has(this._tabLock(v.owner))) continue;
      seen.set(k, v.token);
    }
    if (!seen.size) return [];
    const claimed = new Map();
    await this.cache.modify('outbox', [...seen.keys()], (k, cur) => {
      if (!cur || cur.token !== seen.get(k)) return undefined; // gone, or another tab took it
      const seq = ++this.seq;
      const token = `${this.client}:${seq}`;
      claimed.set(k, { value: cur.value, deleted: !!cur.deleted, seq, token });
      return { value: cur.value, deleted: !!cur.deleted, owner: this.client, token };
    });
    const out = [];
    for (const [k, e] of claimed) {
      if (this.outbox.has(k)) continue; // edited here meanwhile; that edit is newer
      this.outbox.set(k, e);
      out.push([k, e.deleted ? undefined : e.value]);
    }
    return out;
  }

  /** _adopt() for a running tab: never fails a pull. */
  async _adoptOrphans() {
    if (!this.locks) return [];
    try {
      const adopted = await this._adopt(await this.cache.getAll('outbox'));
      if (adopted.length) this._schedule();
      return adopted;
    } catch {
      return [];
    }
  }

  _overlayOutbox(records) {
    for (const [k, v] of this.outbox) {
      if (v.deleted) records.delete(k);
      else records.set(k, v.value);
    }
  }

  /** Read every record from KV, page by page, and replace the device cache. */
  async fullLoad(onProgress) {
    // Saves that land while the records are being listed may be missing from
    // the listing, and this device skips its own log entries, so they are
    // noted (see flush) and read again at the end.
    this.loading = (this.loading || 0) + 1;
    try {
      return await this._fullLoad(onProgress);
    } finally {
      if (!--this.loading) this.landedWhileLoading = null;
    }
  }

  async _fullLoad(onProgress) {
    this.landedWhileLoading ||= new Set();
    const readAt = this.now();
    const rev = Number(await this.kv.get('rev')) || 0;
    const records = new Map();
    let loaded = 0;
    for (const prefix of this.prefixes) {
      let cursor;
      do {
        const page = await this.kv.list({ pattern: `${prefix}:`, returnValues: true, limit: 1000, cursor });
        const items = Array.isArray(page) ? page : page.items || [];
        for (const { key, value } of items) {
          if (value !== null && value !== undefined) records.set(key, value);
        }
        loaded += items.length;
        onProgress?.(loaded);
        cursor = Array.isArray(page) ? null : page.cursor;
      } while (cursor);
    }
    const singles = await Promise.all(this.singles.map((k) => this.kv.get(k)));
    this.singles.forEach((k, i) => {
      if (singles[i] !== null && singles[i] !== undefined) records.set(k, singles[i]);
    });
    this.rev = rev;
    this.syncedAt = readAt;
    this.reachedCloud = true;
    this.gaps = new Map();
    for (let r = Math.max(1, rev - RECHECK + 1); r <= rev; r++) this.gaps.set(r, this.now());
    await this.cache.clear('records');
    await this.cache.write('records', [...records.entries()]);
    await this._saveMeta();
    while (this.landedWhileLoading.size) {
      const keys = [...this.landedWhileLoading].filter((k) => !this.outbox.has(k));
      this.landedWhileLoading.clear();
      const values = await mapLimit(keys, CONCURRENCY, (k) => this.kv.get(k));
      const fresh = keys.map((k, i) => [k, values[i] === null ? undefined : values[i]]);
      for (const [k, v] of fresh) {
        if (v === undefined) records.delete(k);
        else records.set(k, v);
      }
      await this.cache.write('records', fresh);
    }
    this._overlayOutbox(records);
    return records;
  }

  _saveMeta() {
    this.savedSyncedAt = this.syncedAt;
    return this.cache.write('meta', [['state', { rev: this.rev, gaps: [...this.gaps.entries()], syncedAt: this.syncedAt, at: this.now() }]]);
  }

  /**
   * Bring this device up to date with changes made elsewhere.
   * Returns { changes: [[key, value|undefined]], full: Map|null }.
   * `full` is set when the log could not be followed and everything was
   * reloaded; the caller replaces its state with it.
   */
  async pull() {
    let serverRev;
    const readAt = this.now();
    try {
      serverRev = Number(await this.kv.get('rev')) || 0;
    } catch (err) {
      if (isNetworkError(err)) this._setStatus('offline');
      throw err;
    }
    if (serverRev === this.rev && !this.gaps.size) {
      this.syncedAt = readAt;
      // Remembered on the device now and then (it costs no KV request), so a
      // device that is opened often but sees few changes is not mistaken
      // for one that has been away.
      if (readAt - (this.savedSyncedAt || 0) > DAY) this._saveMeta().catch(() => {});
      this.reachedCloud = true;
      return { changes: await this._adoptOrphans(), full: null };
    }
    if (serverRev < this.rev || serverRev - this.rev > MAX_LOG_GAP) {
      await this._adoptOrphans();
      return { changes: [], full: await this.fullLoad() };
    }
    const revs = [...this.gaps.keys()];
    for (let r = this.rev + 1; r <= serverRev; r++) revs.push(r);
    const logs = await mapLimit(revs, CONCURRENCY, (r) => this.kv.get(logKey(r)));
    // Log entries expire. A device away for longer than they are kept cannot
    // follow the log; a missing entry then means it is gone, not late.
    if (this.syncedAt && readAt - this.syncedAt > LOG_KEEP && revs.some((r, i) => r > this.rev && !logs[i])) {
      await this._adoptOrphans();
      return { changes: [], full: await this.fullLoad() };
    }

    // A writer reserves its rev before its batch lands, so an entry can be
    // missing for a moment, or for good if the batch failed. Missing entries
    // are remembered and rechecked on later pulls instead of blocking the
    // ones after them.
    // Worked out on a copy: nothing is committed until the records the log
    // names have been read, so a pull that fails halfway is simply retried.
    const gaps = new Map(this.gaps);
    const keys = new Set();
    let newGap = false;
    for (let i = 0; i < revs.length; i++) {
      const rev = revs[i];
      const log = logs[i];
      if (!log) {
        const first = gaps.get(rev);
        if (first === undefined) { gaps.set(rev, this.now()); newGap = true; }
        else if (this.now() - first > GAP_TTL) gaps.delete(rev);
        continue;
      }
      gaps.delete(rev);
      if (log.client === this.client) continue;
      for (const k of log.keys || []) keys.add(k);
    }
    const wanted = [...keys].filter((k) => !this.outbox.has(k));
    const values = await mapLimit(wanted, CONCURRENCY, (k) => this.kv.get(k));
    // An edit made on this device while those reads were in flight wins.
    const changes = wanted
      .map((k, i) => [k, values[i] === null ? undefined : values[i]])
      .filter(([k]) => !this.outbox.has(k));
    this.rev = serverRev;
    this.gaps = gaps;
    this.syncedAt = readAt;
    this.reachedCloud = true;
    if (newGap) setTimeout(() => this._emit('stale'), 5000);
    // The device copy is a cache: if it cannot be written (storage full, the
    // connection to IndexedDB lost), the changes still reach the books, and
    // the saved rev stays behind so the next launch reads them again.
    try {
      await this.cache.write('records', changes);
      await this._saveMeta();
    } catch {}
    // Checked again: an edit saved during those writes wins too.
    const adopted = await this._adoptOrphans();
    return { changes: [...changes.filter(([k]) => !this.outbox.has(k)), ...adopted], full: null };
  }

  put(key, value) {
    const seq = ++this.seq;
    const token = `${this.client}:${seq}`;
    this.outbox.set(key, { value, deleted: false, seq, token });
    this._queueCache(key, { value, deleted: false, owner: this.client, token }, value);
    this._schedule();
  }

  del(key) {
    const seq = ++this.seq;
    const token = `${this.client}:${seq}`;
    this.outbox.set(key, { value: null, deleted: true, seq, token });
    this._queueCache(key, { value: null, deleted: true, owner: this.client, token }, undefined);
    this._schedule();
  }

  /**
   * Device-cache writes are coalesced into one IndexedDB transaction per
   * tick. A bulk change (an import, a restore) is thousands of puts; one
   * transaction each would queue for seconds, and a reload in that window
   * would lose the tail of the outbox.
   */
  _queueCache(key, outboxEntry, record) {
    if (!this.cacheQueue) {
      this.cacheQueue = { outbox: new Map(), records: new Map() };
      queueMicrotask(() => this.flushCache());
    }
    this.cacheQueue.outbox.set(key, outboxEntry);
    this.cacheQueue.records.set(key, record);
  }

  async flushCache() {
    const q = this.cacheQueue;
    this.cacheQueue = null;
    if (!q) return;
    try {
      await Promise.all([this.cache.write('outbox', [...q.outbox.entries()]), this.cache.write('records', [...q.records.entries()])]);
    } catch {}
  }

  _schedule(delay = this.flushDelay) {
    clearTimeout(this.timer);
    this._setStatus('saving');
    this.timer = setTimeout(() => { this.flush().catch(() => {}); }, delay);
  }

  /** The rev the next batch is logged under. */
  async _reserve() {
    // A rev reserved by an attempt that failed is reused, so a flaky
    // connection does not leave a trail of log entries that never exist.
    // But not for long: other devices give up on a missing entry after
    // GAP_TTL, and would never read one that lands later.
    if (this.reservedRev !== null && this.now() - this.reservedAt > GAP_TTL / 2) this.reservedRev = null;
    if (this.reservedRev === null) {
      this.reservedRev = Number(await this.kv.incr('rev')) || 0;
      this.reservedAt = this.now();
    }
    return this.reservedRev;
  }

  /** Write one batch and its log entry under `rev`. */
  async _send(entries, rev) {
    const sets = entries.filter(([, v]) => !v.deleted).map(([key, v]) => ({ key, value: v.value }));
    const dels = entries.filter(([, v]) => v.deleted).map(([key]) => key);
    const expireAt = Math.floor(this.now() / 1000) + LOG_TTL_DAYS * 86400;
    const log = { key: logKey(rev), value: { keys: entries.map(([k]) => k), client: this.client, at: this.now() }, expireAt };
    // Deletes land before the log names them, so a device that reads
    // the log never fetches a record that is about to disappear.
    await mapLimit(dels, CONCURRENCY, (k) => this.kv.del(k));
    await this.kv.set([...sets, log]);
    this.reservedRev = null;
  }

  /** Send the outbox. Resolves when it is empty or the attempt failed. */
  async flush() {
    if (this.flushing) return this.flushing;
    if (!this.outbox.size) {
      this._setStatus('idle');
      return;
    }
    this.flushing = (async () => {
      // A record the store refuses (not a connection problem) must not hold
      // back everything queued behind it: a refused batch is split in half
      // until the record is found, it is set aside for this round and moved
      // to the back of the queue, and the rest is sent as usual.
      const refused = new Map(); // key -> error
      let limit = BATCH;
      let afterRefusal = false;
      try {
        for (;;) {
          const entries = [];
          for (const e of this.outbox) {
            if (refused.has(e[0])) continue;
            entries.push(e);
            if (entries.length >= limit) break;
          }
          if (!entries.length) break;
          // Failing to reserve a rev is not about any one record.
          const rev = await this._reserve();
          try {
            await this._send(entries, rev);
          } catch (err) {
            if (isNetworkError(err)) throw err;
            // Refused again straight after setting a record aside: more likely
            // the store is refusing everything. Stop here; the next round
            // starts with what has not been tried.
            if (afterRefusal) throw err;
            if (entries.length > 1) { limit = Math.ceil(entries.length / 2); continue; }
            const [k, v] = entries[0];
            refused.set(k, err);
            this.outbox.delete(k);
            this.outbox.set(k, v);
            limit = BATCH;
            afterRefusal = true;
            continue;
          }
          afterRefusal = false;
          limit = Math.min(BATCH, limit * 2);
          // Only drop what has not been edited again while it was in flight.
          const done = new Map(); // key -> token sent
          for (const [k, v] of entries) {
            if (this.outbox.get(k)?.seq === v.seq) {
              this.outbox.delete(k);
              done.set(k, v.token);
              this.landedWhileLoading?.add(k);
            }
          }
          await this.flushCache();
          // On the device too, unless another tab has since queued its own
          // edit under the same key.
          await this.cache.modify('outbox', [...done.keys()], (k, cur) => (cur && cur.token !== done.get(k) ? undefined : null));
          if (rev === this.rev + 1) {
            this.rev = rev;
            await this._saveMeta();
          } else if (rev > this.rev) {
            // Someone else wrote in between; their changes are in the log.
            this._emit('stale');
          }
        }
        if (refused.size) throw refused.values().next().value;
        this.retryDelay = 1000;
        this._setStatus('idle');
        this._emit('saved');
      } catch (err) {
        if (isNetworkError(err)) {
          this._setStatus('offline');
        } else {
          this._setStatus('error', err);
          if (refused.size) this._emit('refused', { keys: [...refused.keys()], error: err });
        }
        // Both kinds are retried, backing off to once a minute. What could
        // not be sent stays in the outbox, here and on the device.
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.flush().catch(() => {}); }, this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 60000);
        throw err;
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  /** Forget everything on this device (sign-out). */
  async reset() {
    clearTimeout(this.timer);
    this.outbox.clear();
    await Promise.all([this.cache.clear('records'), this.cache.clear('outbox'), this.cache.clear('meta')]);
  }
}
