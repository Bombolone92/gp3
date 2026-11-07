/**
 * Where bases live. Layout in the app's folder of the person's Puter cloud:
 *
 *   records/index.json                      list of bases (name, color, starred, trash)
 *   records/bases/<baseId>/base.json        schema: tables, fields, views
 *   records/bases/<baseId>/t/<tableId>/<n>.json   records, CHUNK per file
 *   records/bases/<baseId>/files/<attId>/<name>   attachments (and thumb.webp)
 *
 * Records are split into chunks so a save rewrites only the chunks that
 * changed, never the whole table. Saves are debounced and rate limited
 * (Puter allows a limited number of writes per minute), and every change
 * is journaled locally first so nothing is lost between saves.
 */
import { Emitter } from '../lib/emitter.js';
import { newId } from '../lib/ids.js';
import { Base, makeBaseDoc, uniqueName, setMark } from './base.js';
import { isQuota } from './backend.js';
import { journalSessions, journalEntry } from './journal.js';

export const CHUNK = 2000;
const SAVE_DELAY = 700;
const MAX_WAIT = 4000;
const RETRY = [2000, 5000, 15000, 30000, 60000];
const WRITES_PER_MINUTE = 90;
// A base list change that is only a base's last edit time waits this long.
const INDEX_LAZY = 30000;

const basePath = (id) => `bases/${id}`;
const chunkPath = (baseId, tableId, n) => `bases/${baseId}/t/${tableId}/${n}.json`;

/** Run async jobs with at most `limit` in flight. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

export class Store extends Emitter {
  constructor({ backend, kv, journal, user = '', now = () => Date.now(), writesPerMinute }) {
    super();
    // Puter limits writes per minute; local storage has no such limit.
    this.writesPerMinute = writesPerMinute ?? (backend.kind === 'puter' ? WRITES_PER_MINUTE : Infinity);
    this.backend = backend;
    this.kv = kv;
    this.journal = journal;
    this.user = user;
    this.now = now;
    this.index = { bases: [] };
    this.sessions = new Map();
    this.opening = new Map();
    this.closing = new Map();
    this.writeTimes = [];
    this._indexTimer = 0;
    // Other tabs and devices write the same list (see mergeIndex): base ids
    // in it as last read or written, ids deleted here, and the fields of
    // entries changed here since.
    this.known = new Set();
    this.purged = new Set();
    this.dirty = new Map();
  }

  async init() {
    const file = await this.backend.read('index.json');
    if (file) {
      const bases = await this.parseIndex(file.text);
      this.index = { bases };
      this.known = new Set(bases.map((b) => b.id));
    }
    return this;
  }

  /**
   * The bases in a copy of the list. A damaged one is kept to be copied
   * aside before it is written over, and its bases are listed again: whole
   * entries as they were, others from their own files.
   */
  async parseIndex(text) {
    try {
      const data = JSON.parse(text);
      return Array.isArray(data?.bases) ? data.bases : [];
    } catch {
      this.damagedIndex = text;
    }
    const entries = new Map();
    for (const [m] of text.matchAll(/\{[^{}]*\}/g)) {
      try {
        const e = JSON.parse(m);
        if (typeof e?.id === 'string') entries.set(e.id, e);
      } catch {
        /* cut off */
      }
    }
    for (const [, id] of text.matchAll(/"id"\s*:\s*"([\w-]+)"/g)) if (!entries.has(id)) entries.set(id, { id });
    const found = await pool([...entries.values()], 6, async (e) => {
      const f = await this.backend.read(`${basePath(e.id)}/base.json`).catch(() => null);
      let doc;
      try {
        doc = f && JSON.parse(f.text);
      } catch {
        /* listed all the same */
      }
      if (!f || (doc && !Array.isArray(doc.tables))) return null;
      const d = doc || {};
      return { name: d.name || 'Untitled base', color: d.color || 'blue', icon: d.icon || 'table', createdAt: d.createdAt, updatedAt: d.updatedAt, openedAt: d.updatedAt, starred: false, tables: d.tables?.length, ...e };
    });
    return found.filter(Boolean);
  }

  /** Bases not in the trash, most recently opened first. */
  bases() {
    return this.index.bases.filter((b) => !b.trashedAt);
  }
  trashed() {
    return this.index.bases.filter((b) => b.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt);
  }
  entry(id) {
    return this.index.bases.find((b) => b.id === id) || null;
  }

  /** Wait for a write slot so saves stay under the rate limit. */
  async writeSlot() {
    if (this.writesPerMinute === Infinity) return;
    for (;;) {
      const now = Date.now();
      this.writeTimes = this.writeTimes.filter((t) => now - t < 60000);
      if (this.writeTimes.length < this.writesPerMinute) {
        this.writeTimes.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 60000 - (now - this.writeTimes[0]) + 50));
    }
  }

  async write(path, data) {
    await this.writeSlot();
    return this.backend.write(path, data);
  }

  saveIndexSoon(delay = 400) {
    // A save due sooner stays.
    const due = Date.now() + delay;
    if (this._indexTimer && this._indexDue <= due) return;
    clearTimeout(this._indexTimer);
    this._indexDue = due;
    this._indexTimer = setTimeout(() => this.saveIndex().catch(() => {}), delay);
  }

  /** Save the base list; saves run one after another, each merging after the last write. */
  saveIndex() {
    clearTimeout(this._indexTimer);
    this._indexTimer = 0;
    const run = (this._indexSaving || Promise.resolve()).catch(() => {}).then(() => this.writeIndex());
    this._indexSaving = run;
    return run;
  }

  async writeIndex() {
    await this.mergeIndex();
    if (this.damagedIndex) {
      await this.write(`index.corrupt-${Date.now()}.json`, this.damagedIndex);
      this.damagedIndex = null;
    }
    const dirty = this.dirty;
    this.dirty = new Map();
    try {
      await this.write('index.json', JSON.stringify({ v: 1, bases: this.index.bases }));
    } catch (err) {
      for (const [id, keys] of dirty) for (const k of keys) this.markDirty(id, k);
      throw err;
    }
    this.known = new Set(this.index.bases.map((b) => b.id));
    this.emit('index');
  }

  markDirty(id, key) {
    if (!this.dirty.has(id)) this.dirty.set(id, new Set());
    this.dirty.get(id).add(key);
  }

  /**
   * Take in changes another tab or device saved to the base list since it
   * was read: bases created there are added, bases deleted there are
   * dropped, and entries take their fields except those changed here.
   */
  async mergeIndex() {
    let file;
    try {
      file = await this.backend.read('index.json');
    } catch {
      return;
    }
    const theirs = file ? await this.parseIndex(file.text) : null;
    if (!Array.isArray(theirs)) return;
    const mine = new Map(this.index.bases.map((b) => [b.id, b]));
    const there = new Set();
    for (const t of theirs) {
      if (!t?.id || this.purged.has(t.id)) continue;
      there.add(t.id);
      const m = mine.get(t.id);
      const mineChanged = this.dirty.get(t.id);
      if (!m) this.index.bases.push(t);
      else for (const [k, v] of Object.entries(t)) if (!mineChanged?.has(k)) m[k] = v;
    }
    // Listed when last read, gone now: deleted elsewhere, if its files are
    // gone too (another tab may just have written a list older than it).
    // New ones are ours.
    const gone = new Set();
    for (const b of this.index.bases) {
      if (there.has(b.id) || !this.known.has(b.id)) continue;
      const stat = await this.backend.stat(`${basePath(b.id)}/base.json`).catch(() => null);
      if (!stat) gone.add(b.id);
    }
    if (gone.size) this.index.bases = this.index.bases.filter((b) => !gone.has(b.id));
  }

  updateEntry(id, patch, { save = true } = {}) {
    const e = this.entry(id);
    if (!e) return;
    // Saving a base changes only its edit time here: that is written with
    // the next change to the list, or a little later (or on leaving).
    const lazy = Object.entries(patch).every(([k, v]) => k === 'updatedAt' || e[k] === v);
    // Fields left as they were stay open to changes from other tabs.
    for (const [k, v] of Object.entries(patch)) if (e[k] !== v) this.markDirty(id, k);
    Object.assign(e, patch);
    this.emit('index');
    if (save) this.saveIndexSoon(lazy ? INDEX_LAZY : 400);
  }

  /**
   * Create a base from a document (or a blank one) and its records
   * ({ tableId: record[] }). Returns the new base id.
   */
  async createBase({ id = null, name = 'Untitled base', color = 'blue', icon = 'table', doc = null, records = {} } = {}) {
    const d = doc ? structuredClone(doc) : makeBaseDoc(name, { color, icon });
    if (id) d.id = id;
    if (doc) {
      d.id = id || newId('app');
      d.name = name || d.name;
      d.color = color || d.color;
      d.icon = icon || d.icon;
    }
    // Attachments of the base it was made from (a copy or a backup) are
    // copied, so deleting that base never breaks this one.
    if (doc) await this.copyFiles(d.id, d, records);
    const now = this.now();
    d.createdAt = now;
    d.updatedAt = now;
    const jobs = [];
    for (const t of d.tables) {
      const recs = records[t.id] || [];
      t.chunks = Math.ceil(recs.length / CHUNK);
      for (let n = 0; n < t.chunks; n++) jobs.push({ t: t.id, n, recs: recs.slice(n * CHUNK, (n + 1) * CHUNK) });
    }
    await pool(jobs, 4, (j) => this.write(chunkPath(d.id, j.t, j.n), JSON.stringify({ v: 1, records: j.recs })));
    await this.write(`${basePath(d.id)}/base.json`, JSON.stringify(d));
    this.index.bases.unshift({ id: d.id, name: d.name, color: d.color, icon: d.icon, createdAt: now, updatedAt: now, openedAt: now, starred: false, tables: d.tables.length });
    await this.saveIndex();
    return d.id;
  }

  /**
   * Load a base and keep it saved as it changes. Each openBase is matched by
   * a closeBase; opening a base that is open or loading shares its session.
   */
  async openBase(id) {
    let session = this.sessions.get(id);
    if (!session) {
      let loading = this.opening.get(id);
      if (!loading) {
        loading = this.loadBase(id).finally(() => this.opening.delete(id));
        this.opening.set(id, loading);
      }
      session = await loading;
    }
    session.holders++;
    return session;
  }

  async loadBase(id) {
    if (this.closing.has(id)) await this.closing.get(id);
    if (this.sessions.has(id)) return this.sessions.get(id);
    const file = await this.backend.read(`${basePath(id)}/base.json`);
    if (!file) throw Object.assign(new Error('This base could not be found.'), { code: 'missing' });
    const doc = JSON.parse(file.text);
    const stat = await this.backend.stat(`${basePath(id)}/base.json`).catch(() => null);
    const version = stat ? `${stat.modified}|${stat.size}` : null;
    // What the cloud copy had, to tell what is added elsewhere from what is deleted here (see mergeSchema).
    const known = schemaIds(doc);
    const loaded = pick(doc, ['name', 'color', 'icon']);
    // What was not saved yet: every tab's changes, oldest first.
    const pending = journalSessions(await this.journal?.get(id)).sort((a, b) => (a.at || 0) - (b.at || 0));
    const replay = { schema: false, recs: new Map(), removedTables: new Set() };
    let cloudNewer = false;
    // A journal's schema is taken whole only while the cloud copy is still
    // the one it was based on (entries from before versions: when not older
    // than it), the newest such one first. Otherwise another device (or tab)
    // changed it since: theirs is kept, with the tables and fields made here
    // added to it.
    const fresh = pending.findLast((p) => p.schema && basedOn(p, stat));
    if (fresh) {
      // One saved over another tab's or device's copy (see BaseSession.save)
      // lacks what that one added: it is added back.
      const cloud = fresh.known && structuredClone(doc);
      replaceSchema(doc, fresh.schema, replay);
      if (cloud) {
        addTheirs(doc, cloud, new Set(fresh.known));
        for (const t of doc.tables) replay.removedTables.delete(t.id);
      }
    }
    for (const p of pending) {
      if (!p.schema || p === fresh) continue;
      if (addOffline(doc, p.schema)) replay.schema = true;
      cloudNewer = true;
    }
    const records = {};
    const jobs = [];
    for (const t of doc.tables) {
      records[t.id] = [];
      for (let n = 0; n < (t.chunks || 0); n++) jobs.push({ t: t.id, n });
    }
    const chunks = await pool(jobs, 6, async ({ t, n }) => {
      const f = await this.backend.read(chunkPath(id, t, n));
      if (!f) return [];
      try {
        return JSON.parse(f.text).records || [];
      } catch {
        // Opening without these records would overwrite them on the next save.
        throw Object.assign(new Error('Part of this base could not be read.'), { code: 'corrupt' });
      }
    });
    const chunkOf = new Map();
    jobs.forEach(({ t, n }, k) => {
      for (const r of chunks[k]) {
        records[t].push(r);
        if (!chunkOf.has(t)) chunkOf.set(t, new Map());
        chunkOf.get(t).set(r.id, n);
      }
    });
    // Records are replayed unless another device changed them after they
    // were changed here (modified times are both devices' clocks).
    const edited = new Map();
    let stale = 0;
    const types = new Map(doc.tables.flatMap((t) => t.fields.map((f) => [f.id, f.type])));
    for (const p of pending) {
      // A session's records speak for the fields it had, as it had them:
      // cells of fields added elsewhere since, or whose type is not the one
      // they had there (a value of the other type would not read), stay as
      // the cloud has them.
      const had = p.known ? new Set(p.known) : p.schema ? schemaIds(p.schema) : null;
      const retyped = new Set();
      for (const t of p.schema?.tables || []) for (const f of t.fields) if (types.has(f.id) && types.get(f.id) !== f.type) retyped.add(f.id);
      const theirs = (f) => types.has(f) && (!had.has(f) || retyped.has(f));
      for (const tid of new Set([...Object.keys(p.records || {}), ...Object.keys(p.orders || {})])) {
        if (!records[tid]) continue;
        const byId = new Map(records[tid].map((r) => [r.id, r]));
        if (!edited.has(tid)) edited.set(tid, new Map());
        const times = edited.get(tid);
        const mark = (rid, s) => {
          if (!replay.recs.has(tid)) replay.recs.set(tid, new Map());
          setMark(replay.recs.get(tid), rid, s);
        };
        for (const [rid, rec] of Object.entries(p.records?.[tid] || {})) {
          const cloud = byId.get(rid);
          const at = Math.max(p.edited?.[tid]?.[rid] ?? (rec ? 0 : p.at ?? 0), rec?.mt ?? 0);
          if (cloud && Math.max(cloud.mt ?? 0, times.get(rid) ?? 0) > at) {
            stale++;
            continue;
          }
          if (rec) byId.set(rid, had ? withCloudCells(rec, cloud, theirs) : rec);
          else byId.delete(rid);
          times.set(rid, at);
          mark(rid, rec ? 'changed' : 'deleted');
        }
        // Records only moved here keep the cells they have, wherever from.
        for (const [rid, o] of Object.entries(p.orders?.[tid] || {})) {
          const rec = byId.get(rid);
          if (!rec) continue;
          byId.set(rid, { ...rec, o });
          mark(rid, 'order');
        }
        records[tid] = [...byId.values()];
      }
    }
    const base = new Base(doc, records, { user: this.user, now: this.now });
    for (const k of schemaIds(doc)) known.add(k);
    const session = new BaseSession(this, base, { chunkOf, version, known, loaded });
    this.sessions.set(id, session);
    // Replayed changes are this session's now: its journal takes them over.
    session.replayed = new Map(pending.map((p) => [p.id, p.at]));
    session.editedAt = edited;
    if (pending.length) session.markUnsaved(replay);
    const notes = [];
    if (cloudNewer) notes.push('Some changes to fields or views made on this device while offline were replaced by newer changes from another device.');
    if (stale) notes.push(`${stale === 1 ? 'A record' : `${stale} records`} edited on this device while offline ${stale === 1 ? 'was' : 'were'} changed on another device since; the newer changes were kept.`);
    if (notes.length) session.conflict = notes.join(' ');
    this.updateEntry(id, { openedAt: this.now(), name: doc.name, color: doc.color, icon: doc.icon, tables: doc.tables.length });
    return session;
  }

  /**
   * Save and forget an open base. The session leaves the map right away, so
   * opening the base again waits for this save and then loads a fresh copy.
   */
  closeBase(id) {
    const s = this.sessions.get(id);
    if (!s) return this.closing.get(id) || Promise.resolve();
    // Still open elsewhere (a page left while loading closes late).
    if (--s.holders > 0) return Promise.resolve();
    this.sessions.delete(id);
    const done = (async () => {
      await s.flush().catch(() => {});
      // A save that failed (offline) leaves the changes in the journal, so
      // the next open replays them.
      if (s.hasUnsaved()) await s.writeJournal().catch(() => {});
      s.dispose();
    })().finally(() => {
      if (this.closing.get(id) === done) this.closing.delete(id);
    });
    this.closing.set(id, done);
    return done;
  }

  /**
   * Write unsaved changes of open bases to the journal now: the page is
   * going away, and a local write started now still finishes.
   */
  journalAll() {
    for (const s of this.sessions.values()) if (s.hasUnsaved()) s.writeJournal().catch(() => {});
  }

  async flushAll() {
    await Promise.all([...this.sessions.values()].map((s) => s.flush().catch(() => {})));
    await Promise.all([...this.closing.values()]);
    if (this._indexTimer) await this.saveIndex().catch(() => {});
    await this._indexSaving?.catch(() => {});
  }

  /** Rename or recolor a base that may not be open. */
  async updateBase(id, patch) {
    // A base that was just left may still be saving: let that finish first.
    await this.closing.get(id);
    const s = this.sessions.get(id);
    if (s) {
      s.base.apply({ t: 'base.set', patch }, { label: 'Edit base' });
      return;
    }
    const path = `${basePath(id)}/base.json`;
    const stat = await this.backend.stat(path).catch(() => null);
    const file = await this.backend.read(path);
    if (file) {
      const doc = JSON.parse(file.text);
      Object.assign(doc, patch, { updatedAt: this.now() });
      const res = await this.write(path, JSON.stringify(doc));
      // Schema changes made offline and not saved yet get the patch too, and
      // stay based on the copy just written (so they still apply whole).
      await this.journal?.update(id, (entry) => {
        const sessions = journalSessions(entry);
        if (!sessions.some((p) => p.schema)) return undefined;
        for (const p of sessions) {
          if (!p.schema) continue;
          Object.assign(p.schema, patch);
          if (basedOn(p, stat)) p.version = `${res.modified}|${res.size}`;
          else if (p.legacy) p.version = null;
          delete p.legacy;
        }
        return journalEntry(sessions);
      });
    }
    this.updateEntry(id, { ...pick(patch, ['name', 'color', 'icon']), updatedAt: this.now() });
  }

  async duplicateBase(id, { withRecords = true } = {}) {
    await this.closing.get(id);
    const s = this.sessions.get(id);
    if (s) await s.flush();
    const file = await this.backend.read(`${basePath(id)}/base.json`);
    const doc = JSON.parse(file.text);
    const records = {};
    if (withRecords) {
      for (const t of doc.tables) {
        records[t.id] = [];
        for (let n = 0; n < (t.chunks || 0); n++) {
          const f = await this.backend.read(chunkPath(id, t.id, n));
          if (f) records[t.id].push(...(JSON.parse(f.text).records || []));
        }
      }
    }
    return this.createBase({ name: `${doc.name} copy`, color: doc.color, icon: doc.icon, doc, records });
  }

  /**
   * Copy files that records point at in other bases into this one. A file
   * that cannot be copied keeps its old path.
   */
  async copyFiles(baseId, doc, records) {
    const to = `${basePath(baseId)}/`;
    const copies = new Map();
    const cells = [];
    for (const t of doc.tables) {
      const files = t.fields.filter((f) => f.type === 'attachment');
      if (!files.length) continue;
      for (const r of records[t.id] || []) {
        for (const f of files) {
          const atts = r.c?.[f.id];
          if (!Array.isArray(atts)) continue;
          cells.push([r, f.id]);
          for (const a of atts) {
            for (const k of ['path', 'thumb']) {
              const m = typeof a?.[k] === 'string' && !a[k].startsWith(to) && /^bases\/[^/]+\/(.+)$/.exec(a[k]);
              if (m) copies.set(a[k], to + m[1]);
            }
          }
        }
      }
    }
    const done = new Set();
    await pool([...copies], 4, async ([a, b]) => {
      await this.writeSlot();
      await this.backend.copy(a, b).then(() => done.add(a), () => {});
    });
    for (const [r, fid] of cells) {
      r.c[fid] = r.c[fid].map((a) => {
        const next = { ...a };
        for (const k of ['path', 'thumb']) if (done.has(a?.[k])) next[k] = copies.get(a[k]);
        return next;
      });
    }
  }

  trashBase(id) {
    this.updateEntry(id, { trashedAt: this.now() });
  }
  restoreBase(id) {
    this.updateEntry(id, { trashedAt: null });
  }
  setStarred(id, starred) {
    this.updateEntry(id, { starred });
  }

  /** Delete a base and its files for good. */
  async purgeBase(id) {
    await this.closing.get(id);
    const s = this.sessions.get(id);
    if (s) {
      s.dispose();
      this.sessions.delete(id);
      // A save still writing would recreate files after they are removed.
      await s.flushing?.catch(() => {});
    }
    await this.journal?.del(id);
    await this.backend.remove(basePath(id));
    this.purged.add(id);
    this.index.bases = this.index.bases.filter((b) => b.id !== id);
    await this.saveIndex();
  }

  /* --------------------------------------------------------- attachments */

  /** Save a file for a base. Returns the attachment value. */
  async putFile(baseId, file, { thumb } = {}) {
    const id = newId('att');
    const name = safeName(file.name || 'file');
    const path = `${basePath(baseId)}/files/${id}/${name}`;
    await this.write(path, file);
    const att = { id, name: file.name || name, size: file.size, type: file.type || '', path };
    if (thumb?.blob) {
      const tp = `${basePath(baseId)}/files/${id}/thumb.webp`;
      await this.write(tp, thumb.blob);
      att.thumb = tp;
      att.width = thumb.width;
      att.height = thumb.height;
    }
    return att;
  }

  readFile(path) {
    return this.backend.readBlob(path);
  }

  /* -------------------------------------------------------------- prefs */

  async getPrefs() {
    return (await this.kv?.get('prefs')) || {};
  }
  async setPrefs(prefs) {
    try {
      await this.kv?.set('prefs', prefs);
    } catch {
      /* settings are a convenience */
    }
  }
}

/**
 * Whether a journal session was based on the cloud copy of base.json with
 * this stat (entries from before versions: when not older than it).
 */
function basedOn(p, stat) {
  if (p.legacy) return !(stat?.modified && p.at && stat.modified > p.at);
  return !!stat && p.version === `${stat.modified}|${stat.size}`;
}

/** Take an offline copy of the schema whole; tables it no longer has were deleted offline. */
function replaceSchema(doc, schema, replay) {
  const chunks = new Map(doc.tables.map((t) => [t.id, t.chunks || 0]));
  for (const t of doc.tables) if (!schema.tables.some((x) => x.id === t.id)) replay.removedTables.add(t.id);
  Object.keys(doc).forEach((k) => delete doc[k]);
  Object.assign(doc, schema);
  // Chunk files written since are still read.
  for (const t of doc.tables) t.chunks = Math.max(t.chunks || 0, chunks.get(t.id) || 0);
  replay.schema = true;
}

/**
 * Add what an offline copy of the schema made to a newer one: tables it
 * has that the newer one does not (made offline, or deleted elsewhere
 * since: kept rather than lost), and fields added to tables both have. A
 * link comes only with its other side. Returns whether anything was added.
 */
function addOffline(doc, offline) {
  let changed = false;
  const tables = new Map(doc.tables.map((t) => [t.id, t]));
  const added = new Set();
  for (const t of offline.tables || []) {
    if (tables.has(t.id)) continue;
    doc.tables.push(t);
    tables.set(t.id, t);
    added.add(t.id);
    changed = true;
  }
  const offlineHas = (tid, fid) => offline.tables.some((t) => t.id === tid && t.fields.some((f) => f.id === fid));
  for (const t of offline.tables || []) {
    if (added.has(t.id)) continue;
    const mine = tables.get(t.id);
    for (const f of t.fields) {
      if (mine.fields.some((x) => x.id === f.id)) continue;
      if (f.type === 'link') {
        const target = tables.get(f.options?.tableId);
        const inv = f.options?.inverseId;
        if (!target || (inv && !target.fields.some((x) => x.id === inv) && !offlineHas(target.id, inv))) continue;
      }
      mine.fields.push({ ...f, name: uniqueName(f.name, mine.fields.map((x) => x.name)) });
      changed = true;
    }
  }
  return changed;
}

/**
 * Add to a schema what another copy of it has that this one never had
 * (known: ids this one has had; others were deleted here): tables, fields
 * and views, and the chunk files and record numbers given there.
 */
function addTheirs(doc, theirs, known) {
  const mine = new Map(doc.tables.map((t) => [t.id, t]));
  for (const tt of theirs.tables) {
    const t = mine.get(tt.id);
    if (!t) {
      if (!known.has(tt.id)) doc.tables.push(tt);
      continue;
    }
    t.chunks = Math.max(t.chunks || 0, tt.chunks || 0);
    if ((tt.nextNumber || 0) > (t.nextNumber || 0)) t.nextNumber = tt.nextNumber;
    for (const key of ['fields', 'views']) {
      const have = new Set(t[key].map((x) => x.id));
      const extra = (tt[key] || []).filter((x) => x?.id && !have.has(x.id) && !known.has(x.id));
      if (extra.length) t[key] = [...t[key], ...extra];
    }
  }
}

/** A record with the cloud copy's cells of the fields `theirs` picks. */
function withCloudCells(rec, cloud, theirs) {
  const c = {};
  for (const [f, v] of Object.entries(rec.c || {})) if (!theirs(f)) c[f] = v;
  for (const [f, v] of Object.entries(cloud?.c || {})) if (theirs(f)) c[f] = v;
  return { ...rec, c };
}

/** Ids of a schema's tables, fields and views. */
function schemaIds(doc) {
  const ids = new Set();
  for (const t of doc.tables || []) {
    ids.add(t.id);
    for (const f of t.fields || []) ids.add(f.id);
    for (const v of t.views || []) ids.add(v.id);
  }
  return ids;
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}

function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
}

/**
 * An open base and its saving. Status: 'saved', 'pending', 'saving',
 * 'offline' or 'error'.
 */
export class BaseSession extends Emitter {
  constructor(store, base, { chunkOf, version, known = schemaIds(base.doc), loaded = pick(base.doc, ['name', 'color', 'icon']) }) {
    super();
    this.store = store;
    this.base = base;
    this.id = base.id;
    // This open of the base, as its journal knows it (one per tab).
    this.sessionId = newId('ses');
    // Journal sessions replayed into this one: id -> their time then.
    this.replayed = new Map();
    this.journalAt = 0;
    // When records not saved yet were changed here: tableId -> recordId -> ms.
    this.editedAt = new Map();
    this.status = 'saved';
    this.error = null;
    this.chunkOf = chunkOf;
    this.members = new Map();
    for (const [tid, m] of chunkOf) {
      const arr = [];
      for (const [rid, n] of m) (arr[n] ||= new Set()).add(rid);
      this.members.set(tid, arr);
    }
    this.baseVersion = version;
    // Ids of tables, fields and views this copy has had, and the base's name,
    // color and icon as last loaded or saved (see mergeSchema).
    this.known = known;
    this.loaded = loaded;
    this.holders = 0;
    this.unsaved = { schema: false, recs: new Map(), removedTables: new Set() };
    this.timer = 0;
    this.firstDirtyAt = 0;
    this.retry = 0;
    this.flushing = null;
    this.journalTimer = 0;
    this.off = base.on('change', (change) => this.onChange(change));
  }

  dispose() {
    // A save still running when the base was closed or deleted must not
    // retry or journal afterwards (it would recreate a deleted base).
    this.disposed = true;
    this.off?.();
    clearTimeout(this.timer);
    clearTimeout(this.journalTimer);
  }

  setStatus(status, error = null) {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    this.emit('status', status, error);
  }

  onChange(change) {
    if (change.remote) return;
    const now = this.store.now();
    for (const [tid, m] of change.records || []) {
      let times = this.editedAt.get(tid);
      if (!times) this.editedAt.set(tid, (times = new Map()));
      // A record only moved is not edited.
      for (const [rid, s] of m) if (s !== 'order') times.set(rid, now);
    }
    this.markUnsaved(change);
  }

  markUnsaved(change) {
    const u = this.unsaved;
    if (change.schema) u.schema = true;
    // Record marks of a removed table stay: if the table is restored before
    // the save, deleted records must still be written out of its chunks.
    for (const t of change.removedTables || []) {
      u.removedTables.add(t);
      u.schema = true;
    }
    const recs = change.records instanceof Map ? change.records : change.recs;
    for (const [tid, m] of recs || []) {
      let t = u.recs.get(tid);
      if (!t) u.recs.set(tid, (t = new Map()));
      for (const [rid, s] of m) setMark(t, rid, s);
      if (this.base.table(tid)) u.removedTables.delete(tid);
    }
    if (!this.firstDirtyAt) this.firstDirtyAt = Date.now();
    this.setStatus(this.status === 'error' || this.status === 'offline' ? this.status : 'pending');
    this.scheduleJournal();
    this.schedule();
  }

  /**
   * Mark a failed save's changes unsaved again. Marks made while it ran are
   * newer and win (a record deleted, then restored by Undo, stays changed),
   * except that a record changed and then moved stays changed.
   */
  requeue(u) {
    const cur = this.unsaved;
    const back = { schema: u.schema, recs: new Map(), removedTables: new Set() };
    for (const t of u.removedTables) if (!this.base.table(t)) back.removedTables.add(t);
    for (const [tid, m] of u.recs) {
      const newer = cur.recs.get(tid);
      const keep = new Map([...m].filter(([rid, s]) => !newer?.has(rid) || (s === 'changed' && newer.get(rid) === 'order')));
      if (keep.size) back.recs.set(tid, keep);
    }
    this.markUnsaved(back);
  }

  /** Save after a pause in editing (at most MAX_WAIT after the first change), or after a retry delay. */
  schedule(delay = SAVE_DELAY, { retry = false } = {}) {
    clearTimeout(this.timer);
    if (this.disposed) return;
    const waited = Date.now() - this.firstDirtyAt;
    this.timer = setTimeout(() => this.flush().catch(() => {}), retry ? delay : Math.max(0, Math.min(delay, MAX_WAIT - waited)));
  }

  scheduleJournal() {
    clearTimeout(this.journalTimer);
    if (this.disposed) return;
    this.journalTimer = setTimeout(() => this.writeJournal(), 150);
  }

  async writeJournal() {
    const journal = this.store.journal;
    if (!journal) return;
    const u = this.unsaved;
    const pendingFlush = this.flushingSnapshot;
    const records = {};
    const edited = {};
    // Records only moved keep just their order.
    const orders = {};
    const addRecs = (map) => {
      for (const [tid, m] of map) {
        const table = this.base.table(tid);
        if (!table) continue;
        const times = this.editedAt.get(tid);
        for (const [rid, s] of m) {
          if (s === 'order') {
            const r = table.record(rid);
            if (r && !(records[tid] && rid in records[tid])) (orders[tid] ||= {})[rid] = r.o;
            continue;
          }
          (records[tid] ||= {})[rid] = s === 'deleted' ? null : table.record(rid) || null;
          if (orders[tid]) delete orders[tid][rid];
          if (times?.has(rid)) (edited[tid] ||= {})[rid] = times.get(rid);
        }
      }
    };
    if (pendingFlush) addRecs(pendingFlush.recs);
    addRecs(u.recs);
    const schema = u.schema || pendingFlush?.schema || pendingFlush?.removedTables?.size || u.removedTables.size ? this.base.doc : null;
    // Times only go up, so other tabs can tell this entry changed.
    this.journalAt = Math.max(this.store.now(), this.journalAt + 1);
    const own = schema || Object.keys(records).length || Object.keys(orders).length ? { id: this.sessionId, at: this.journalAt, version: this.wroteVersion || this.baseVersion, schema, records, orders, edited } : null;
    // Saved over another copy: what that one added is told apart by the ids this one has had.
    if (own && this.wroteVersion) own.known = [...this.known];
    // Other tabs' sessions stay. Those replayed here are part of this one,
    // unless written again since (that tab is still open and editing).
    await journal.update(this.id, (entry) => {
      if (!entry && !own) return undefined;
      const sessions = journalSessions(entry).filter((s) => s.id !== this.sessionId && !(this.replayed.has(s.id) && this.replayed.get(s.id) === s.at));
      if (own) sessions.push(own);
      return journalEntry(sessions);
    });
  }

  hasUnsaved() {
    return this.unsaved.schema || this.unsaved.recs.size > 0 || this.unsaved.removedTables.size > 0 || !!this.flushing;
  }

  /** Save everything that changed. */
  async flush() {
    clearTimeout(this.timer);
    // Wait for every save in progress, not just the first one.
    while (this.flushing) await this.flushing.catch(() => {});
    const u = this.unsaved;
    if (!u.schema && !u.recs.size && !u.removedTables.size) {
      if (this.status !== 'saved') this.setStatus('saved');
      return;
    }
    this.unsaved = { schema: false, recs: new Map(), removedTables: new Set() };
    this.firstDirtyAt = 0;
    this.flushingSnapshot = u;
    this.setStatus('saving');
    this.flushing = this.save(u);
    try {
      await this.flushing;
      this.retry = 0;
      this.flushingSnapshot = null;
      this.flushing = null;
      for (const [tid, m] of u.recs) {
        const times = this.editedAt.get(tid);
        const still = this.unsaved.recs.get(tid);
        if (times) for (const rid of m.keys()) if (!still?.has(rid)) times.delete(rid);
      }
      if (this.hasUnsaved()) {
        this.setStatus('pending');
        this.schedule();
      } else {
        this.setStatus('saved');
      }
      this.writeJournal();
    } catch (err) {
      this.flushingSnapshot = null;
      this.flushing = null;
      // Put the changes back so the next try includes them.
      this.requeue(u);
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      this.setStatus(offline ? 'offline' : 'error', isQuota(err) ? 'Your Puter storage is full. Free up space to keep saving.' : err?.message || String(err));
      const wait = RETRY[Math.min(this.retry, RETRY.length - 1)];
      this.retry++;
      this.schedule(wait, { retry: true });
      throw err;
    }
  }

  assign(tid, rid) {
    let m = this.chunkOf.get(tid);
    if (!m) this.chunkOf.set(tid, (m = new Map()));
    if (m.has(rid)) return m.get(rid);
    let arr = this.members.get(tid);
    if (!arr) this.members.set(tid, (arr = []));
    const table = this.base.table(tid);
    const count = Math.max(arr.length, table?.schema.chunks || 0);
    let n = -1;
    // Fill the last chunk first; earlier chunks with room come next.
    for (let i = count - 1; i >= 0; i--) {
      if ((arr[i]?.size || 0) < CHUNK) {
        n = i;
        break;
      }
    }
    if (n < 0) n = count;
    (arr[n] ||= new Set()).add(rid);
    m.set(rid, n);
    if (table && (table.schema.chunks || 0) <= n) {
      table.schema.chunks = n + 1;
    }
    return n;
  }

  async save(u) {
    const store = this.store;
    const baseId = this.id;
    // Another tab or device saved since this copy was loaded or saved: what
    // it saved is merged in rather than overwritten.
    const theirs = await this.readTheirs();
    // Tables removed for good.
    for (const tid of u.removedTables) {
      if (this.base.table(tid)) continue;
      await store.backend.remove(`bases/${baseId}/t/${tid}`);
      this.chunkOf.delete(tid);
      this.members.delete(tid);
    }
    // Work out which chunks changed.
    const dirty = [];
    const removed = [];
    for (const [tid, m] of u.recs) {
      const table = this.base.table(tid);
      if (!table) continue;
      const chunks = new Set();
      for (const [rid, s] of m) {
        if (s === 'deleted' || !table.record(rid)) {
          // The record stays mapped to its chunk until the chunk is written,
          // so a failed save retries the right file.
          const n = this.chunkOf.get(tid)?.get(rid);
          if (n !== undefined) {
            chunks.add(n);
            removed.push([tid, rid, n]);
          }
        } else {
          chunks.add(this.assign(tid, rid));
        }
      }
      for (const n of chunks) dirty.push({ tid, n });
    }
    await pool(dirty, 4, async ({ tid, n }) => {
      const table = this.base.table(tid);
      // Deleted while earlier chunks were written: the next save removes it.
      if (!table) return;
      const ids = this.members.get(tid)?.[n] || new Set();
      let records = [];
      for (const rid of ids) {
        const r = table.record(rid);
        if (r) records.push(r);
      }
      if (theirs) records = await this.mergeChunk(table, n, records, u.recs.get(tid));
      await store.write(chunkPath(baseId, tid, n), JSON.stringify({ v: 1, records }));
    });
    for (const [tid, rid, n] of removed) {
      if (this.base.table(tid)?.record(rid)) continue;
      this.members.get(tid)?.[n]?.delete(rid);
      this.chunkOf.get(tid)?.delete(rid);
    }
    // The schema doubles as the manifest of chunk files, so it is written
    // after the chunks it describes.
    const doc = this.base.doc;
    doc.updatedAt = store.now();
    for (const k of schemaIds(doc)) this.known.add(k);
    const out = theirs ? this.mergeSchema(theirs) : doc;
    const res = await store.write(`bases/${baseId}/base.json`, JSON.stringify(out));
    this.loaded = pick(out, ['name', 'color', 'icon']);
    // After a merge this copy lacks what the other one added, so it stays
    // behind: later saves merge too, until the base is loaded again. Its
    // journal is based on the copy written (see loadBase).
    if (theirs) this.wroteVersion = `${res.modified}|${res.size}`;
    else [this.baseVersion, this.wroteVersion] = [`${res.modified}|${res.size}`, null];
    store.updateEntry(baseId, { name: out.name, color: out.color, icon: out.icon, updatedAt: doc.updatedAt, tables: out.tables.length });
  }

  /** The schema another tab or device saved since this copy was loaded or saved, if any. */
  async readTheirs() {
    if (!this.baseVersion) return null;
    const path = `bases/${this.id}/base.json`;
    // When it cannot be told, merging with an unchanged copy does no harm.
    const stat = await this.store.backend.stat(path).catch(() => undefined);
    if (stat === null || (stat && `${stat.modified}|${stat.size}` === this.baseVersion)) return null;
    const file = await this.store.backend.read(path);
    try {
      const doc = file && JSON.parse(file.text);
      return Array.isArray(doc?.tables) ? doc : null;
    } catch {
      return null;
    }
  }

  /**
   * A chunk merged with the copy another tab or device saved: records
   * changed here replace theirs (keeping cells of fields added there),
   * records deleted here go, records only moved here take just their new
   * order, and the rest stay as they saved them.
   */
  async mergeChunk(table, n, mine, marks) {
    const f = await this.store.backend.read(chunkPath(this.id, table.id, n));
    let out;
    try {
      out = new Map((f ? JSON.parse(f.text).records || [] : []).map((r) => [r.id, r]));
    } catch {
      return mine;
    }
    const fields = new Set(table.fields.map((x) => x.id));
    const at = this.chunkOf.get(table.id);
    for (const [rid, s] of marks || []) {
      if (at?.get(rid) !== n) continue;
      const r = table.record(rid);
      if (s === 'deleted' || !r) {
        out.delete(rid);
        continue;
      }
      if (s === 'order') {
        // Gone there: deleted since.
        if (out.has(rid)) out.set(rid, { ...out.get(rid), o: r.o });
        continue;
      }
      const extra = Object.entries(out.get(rid)?.c || {}).filter(([k]) => !fields.has(k) && !this.known.has(k));
      out.set(rid, extra.length ? { ...r, c: { ...Object.fromEntries(extra), ...r.c } } : r);
    }
    return [...out.values()];
  }

  /**
   * The schema to write over one another tab or device saved: this one,
   * plus the tables, fields and views added there (ones this copy has had
   * were deleted here), the chunk files written there, and the base's name,
   * color and icon when only changed there. Other schema edits made in both
   * places: this copy's win.
   */
  mergeSchema(theirs) {
    const doc = this.base.doc;
    const out = { ...doc, tables: doc.tables.map((t) => ({ ...t })) };
    const took = {};
    for (const [k, v] of Object.entries(this.loaded)) {
      if (doc[k] !== v || theirs[k] === undefined) continue;
      out[k] = theirs[k];
      if (theirs[k] !== v) took[k] = theirs[k];
    }
    // Taken here too, so a later save does not put the old ones back.
    if (Object.keys(took).length) {
      Object.assign(doc, took);
      Object.assign(this.loaded, took);
      this.base.emit('change', { schema: true, records: new Map(), tables: new Set(), removedTables: new Set(), remote: true }, { t: 'base.set', patch: took });
    }
    addTheirs(out, theirs, this.known);
    // Numbers given there are not given again here.
    for (const t of out.tables) {
      const table = this.base.table(t.id);
      if (table && (t.nextNumber || 0) > (table.schema.nextNumber || 0)) table.schema.nextNumber = t.nextNumber;
    }
    return out;
  }

  /**
   * Has another device saved this base since we loaded or saved it?
   * Used when the window regains focus.
   */
  async changedElsewhere() {
    const stat = await this.store.backend.stat(`bases/${this.id}/base.json`).catch(() => null);
    if (!stat || !this.baseVersion) return false;
    return `${stat.modified}|${stat.size}` !== this.baseVersion;
  }
}
