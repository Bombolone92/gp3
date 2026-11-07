/**
 * The app's local copy of one help desk. Tickets, customers, organizations
 * and article summaries are held in memory (and cached in IndexedDB), so
 * views, search and reports never wait on the network. The copy is kept
 * current by polling the desk's numbered change feed: each poll is one tiny
 * read when nothing changed, and returns exactly the changed records when
 * something did.
 */
import { loadDesk, saveDesk, clearDesk } from './cache.js';
import { accessRevoked, ApiError } from './api.js';

const KIND = { t: 'tickets', u: 'users', o: 'orgs', a: 'articles' };
const RECORD_KINDS = ['t', 'u', 'o', 'a'];
const SCHEMA = 1;
// A request that hangs (a stalled connection after the computer slept)
// would otherwise hold up every later poll for the rest of the session.
const REQUEST_TIMEOUT = 20000;

function withTimeout(promise, ms = REQUEST_TIMEOUT) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(0, { error: 'timeout', message: 'The help desk server took too long to answer.' })), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * Whether `a` is an older copy of a record than `b`. Tickets carry a `ver`
 * that every write bumps, which orders copies even when two updates landed
 * in the opposite order of their clocks; otherwise `updatedAt` decides.
 */
function isOlder(a, b) {
  if ((typeof a.ver === 'number' || typeof b.ver === 'number') && (a.ver || 0) !== (b.ver || 0)) return (a.ver || 0) < (b.ver || 0);
  return !!(a.updatedAt && b.updatedAt && b.updatedAt > a.updatedAt);
}

export class Replica extends EventTarget {
  constructor(api, ref, { pollMs = 3000, hiddenPollMs = 30000 } = {}) {
    super();
    this.api = api;
    this.ref = ref;
    this.tickets = new Map();
    this.users = new Map();
    this.orgs = new Map();
    this.articles = new Map();
    this.meta = null;
    this.members = {};
    this.cfg = {};
    this.me = null;
    this.rev = 0;
    this.ready = false;
    this.status = 'connecting';
    this.pollMs = pollMs;
    this.hiddenPollMs = hiddenPollMs;
    this.timer = null;
    this.closed = false;
    this.failures = 0;
    this.gapSince = null;
    this.dirty = { puts: new Map(), dels: new Map() };
    this.flushTimer = null;
    this.openedAt = Date.now();
    this.onVisible = () => {
      if (document.visibilityState === 'visible') this.kick();
    };
  }

  map(kind) {
    return this[KIND[kind]];
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', { status });
  }

  /** Load from cache (fast), then from the server. */
  async open() {
    const cached = await loadDesk(this.ref);
    if (cached && cached.state?.schema === SCHEMA) {
      for (const k of RECORD_KINDS) for (const r of cached[k] || []) this.map(k).set(r.id, r);
      Object.assign(this, { meta: cached.state.meta, members: cached.state.members || {}, cfg: cached.state.cfg || {}, me: cached.state.me, rev: cached.state.rev || 0 });
      this.ready = true;
      this.emit('change', { kinds: new Set(['t', 'u', 'o', 'a', 'm', 'c', 'd']), initial: true });
    }
    const boot = await this.api.get('/bootstrap');
    this.applyBoot(boot);
    if (!this.ready || !cached || boot.rev - this.rev > 400) {
      await this.fullLoad({ boot });
    } else {
      await this.sync();
    }
    this.ready = true;
    this.setStatus('live');
    this.emit('change', { kinds: new Set(['t', 'u', 'o', 'a', 'm', 'c', 'd']), initial: true });
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onVisible);
    this.schedule();
    return this;
  }

  close({ save = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.flushTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onVisible);
    if (save) this.flush();
  }

  /** The desk's details, team and settings, and who this agent is. */
  applyBoot(boot) {
    this.meta = boot.meta;
    this.members = boot.members || {};
    this.cfg = boot.cfg || {};
    this.me = boot.me;
  }

  /**
   * Read everything from the server: the desk's settings and team, then
   * every record a page at a time. The feed is replayed from the older of
   * the two reads, so nothing written in between is missed.
   */
  async fullLoad({ boot = null } = {}) {
    this.setStatus('loading');
    if (!boot) {
      boot = await withTimeout(this.api.get('/bootstrap'));
      this.applyBoot(boot);
    }
    let rev = null;
    const fresh = { t: new Map(), u: new Map(), o: new Map(), a: new Map() };
    for (const [kind, name] of [['t', 'tickets'], ['u', 'users'], ['o', 'orgs'], ['a', 'articles']]) {
      let cursor = null;
      do {
        const page = await withTimeout(this.api.get(`/records/${name}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`));
        if (page.rev !== null && page.rev !== undefined && rev === null) rev = page.rev;
        for (const r of page.items) fresh[kind].set(r.id, r);
        cursor = page.cursor;
      } while (cursor);
    }
    if (this.closed) return;
    await clearDesk(this.ref);
    for (const k of RECORD_KINDS) this[KIND[k]] = fresh[k];
    this.rev = Math.min(rev ?? this.rev, Number(boot.rev) || 0);
    this.dirty.puts.clear();
    this.dirty.dels.clear();
    for (const k of RECORD_KINDS) for (const r of fresh[k].values()) this.dirty.puts.set(`${k}:${r.id}`, { kind: k, id: r.id, v: r });
    // Changes written while the pages were read are replayed here.
    await this.pull({ nested: true });
    this.flushSoon(0);
    // Everything may have changed; let open views repaint.
    if (this.ready) this.emit('change', { kinds: new Set(['t', 'u', 'o', 'a', 'm', 'c', 'd']) });
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (this.closed) return;
    const base = document.visibilityState === 'hidden' ? this.hiddenPollMs : this.pollMs;
    const backoff = this.failures ? Math.min(60000, base * 2 ** this.failures) : base;
    this.timer = setTimeout(() => this.tick(), ms ?? backoff);
  }

  kick() {
    this.schedule(0);
  }

  async tick() {
    if (this.closed) return;
    try {
      await this.sync();
      // Closed while the request was out (another desk, signing out): what
      // it brought back belongs to nobody now.
      if (this.closed) return;
      this.failures = 0;
      this.setStatus('live');
    } catch (e) {
      if (this.closed) return;
      this.failures = Math.min(this.failures + 1, 5);
      if (accessRevoked(e)) {
        this.setStatus('removed');
        this.emit('removed', { error: e });
        return;
      }
      this.setStatus('offline');
    }
    this.schedule();
  }

  async sync() {
    if (this.syncing) return this.syncing;
    this.syncing = this.pull();
    try {
      return await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  /** One round of the change feed. `nested` stops a reload from looping. */
  async pull({ nested = false } = {}) {
    const res = await withTimeout(this.api.get(`/sync?since=${this.rev}`));
    if (this.closed) return;
    if (res.reset) {
      if (!nested) await this.fullLoad();
      return;
    }
    if (res.changes?.length) this.applyChanges(res.changes, { live: true });
    if (res.rev > this.rev) this.rev = res.rev;
    if (res.gap) {
      // A writer took a revision but its entry has not landed yet. Wait a
      // few polls for it; if it never comes (a failed write, or entries
      // that expired while this device was away), reload everything.
      if (this.gapSince === null) this.gapSince = Date.now();
      else if (Date.now() - this.gapSince > 15000 && !nested) {
        this.gapSince = null;
        await this.fullLoad();
        return;
      }
    } else this.gapSince = null;
    this.flushSoon();
  }

  applyChanges(changes, { live = false } = {}) {
    const kinds = new Set();
    const ids = { t: new Set(), u: new Set(), o: new Set(), a: new Set() };
    for (const c of changes) {
      kinds.add(c.k);
      if (RECORD_KINDS.includes(c.k)) {
        if (c.v === null) this.remove(c.k, c.id);
        else this.put(c.k, c.v);
        ids[c.k].add(c.id);
        if (live && c.k === 't' && c.ev) this.emit('activity', { change: c, ticket: c.v });
      } else if (c.k === 'm') this.members = c.v || {};
      else if (c.k === 'c') this.cfg = { ...this.cfg, [c.id]: c.v };
      else if (c.k === 'd') this.meta = c.v;
      if (c.k === 'm' && this.me && this.members[this.me.uuid]) this.me = this.members[this.me.uuid];
    }
    if (kinds.size) this.emit('change', { kinds, ids });
  }

  put(kind, record) {
    const map = this.map(kind);
    const cur = map.get(record.id);
    // Never let an older copy (a late feed entry) replace a newer one.
    if (cur && isOlder(record, cur)) return false;
    map.set(record.id, record);
    this.dirty.dels.delete(`${kind}:${record.id}`);
    this.dirty.puts.set(`${kind}:${record.id}`, { kind, id: record.id, v: record });
    return true;
  }

  remove(kind, id) {
    this.map(kind).delete(id);
    this.dirty.puts.delete(`${kind}:${id}`);
    this.dirty.dels.set(`${kind}:${id}`, { kind, id });
  }

  /** Apply a record returned by a mutation right away. */
  upsert(kind, record) {
    if (!record) return;
    if (this.put(kind, record)) {
      this.emit('change', { kinds: new Set([kind]), ids: { [kind]: new Set([record.id]) } });
      this.flushSoon();
    }
  }

  /** Apply many records of one kind at once, with a single change event. */
  upsertMany(kind, records) {
    const ids = new Set();
    for (const r of records || []) if (r && this.put(kind, r)) ids.add(r.id);
    if (!ids.size) return;
    this.emit('change', { kinds: new Set([kind]), ids: { [kind]: ids } });
    this.flushSoon();
  }

  drop(kind, id) {
    this.remove(kind, id);
    this.emit('change', { kinds: new Set([kind]), ids: { [kind]: new Set([id]) } });
    this.flushSoon();
  }

  setConfig(kind, value) {
    this.cfg = { ...this.cfg, [kind]: value };
    this.emit('change', { kinds: new Set(['c']) });
    this.flushSoon();
  }

  setMeta(meta) {
    this.meta = meta;
    this.emit('change', { kinds: new Set(['d']) });
    this.flushSoon();
  }

  setMembers(members) {
    this.members = members;
    if (this.me && members[this.me.uuid]) this.me = members[this.me.uuid];
    this.emit('change', { kinds: new Set(['m']) });
    this.flushSoon();
  }

  flushSoon(ms = 600) {
    clearTimeout(this.flushTimer);
    if (this.closed) return;
    this.flushTimer = setTimeout(() => this.flush(), ms);
  }

  async flush() {
    clearTimeout(this.flushTimer);
    const puts = [...this.dirty.puts.values()];
    const dels = [...this.dirty.dels.values()];
    this.dirty.puts.clear();
    this.dirty.dels.clear();
    const saved = await saveDesk(this.ref, {
      puts,
      dels,
      state: { schema: SCHEMA, rev: this.rev, meta: this.meta, members: this.members, cfg: this.cfg, me: this.me, savedAt: Date.now() },
    });
    if (saved === false) {
      // Nothing was written. Keep these changes for the next save, unless a
      // newer one replaced them meanwhile: a later save would otherwise
      // store a newer revision without them, and they would never be fetched.
      for (const c of [...puts, ...dels]) {
        const k = `${c.kind}:${c.id}`;
        if (this.dirty.puts.has(k) || this.dirty.dels.has(k)) continue;
        if ('v' in c) this.dirty.puts.set(k, c);
        else this.dirty.dels.set(k, c);
      }
    }
  }

  /* --------------------------------------------------------- queries */

  member(uuid) {
    return uuid ? this.members[uuid] || null : null;
  }

  agents({ includeInactive = false } = {}) {
    return Object.values(this.members).filter((m) => includeInactive || m.active).sort((a, b) => a.name.localeCompare(b.name));
  }

  isAdmin() {
    return this.me && this.me.role !== 'agent';
  }

  ticketsFor(predicate) {
    const out = [];
    for (const t of this.tickets.values()) if (predicate(t)) out.push(t);
    return out;
  }

  requesterOf(t) {
    return this.users.get(t.requester) || null;
  }
}
