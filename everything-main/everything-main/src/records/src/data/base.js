/**
 * A base: tables of fields, views and records, changed only through
 * operations. Every operation returns its inverse, which gives undo and
 * redo for free and tells storage exactly what changed.
 *
 * Schema (saved as base.json):
 *   { id, name, color, icon, tables: [{ id, name, primaryFieldId, fields, views, nextNumber }] }
 * Records (saved in chunks per table):
 *   { id, c: { fieldId: value }, o: order, ct: created ms, mt: modified ms, cb, mb }
 *
 * Link fields keep both sides in step: setting a link cell also updates the
 * inverse field of every linked record.
 */
import { Emitter } from '../lib/emitter.js';
import { newId } from '../lib/ids.js';
import { nextColor, HUES } from '../lib/colors.js';
import { dateKey } from '../lib/format.js';
import { defaultOptions, isComputed, convertValue, TYPES, PRIMARY_TYPES, toText, listText, splitList, valueKind } from './fields.js';
import { OPERATORS, NO_VALUE_OPS } from './query.js';
import { createView } from './views.js';
import { Compute } from './compute.js';

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const HISTORY_MAX = 20;
const HISTORY_BULK = 50;
const cut = (s) => (s.length > 120 ? `${s.slice(0, 119)}\u2026` : s);

export class Table {
  constructor(schema, records = []) {
    this.schema = schema;
    this.records = new Map();
    for (const r of records) this.records.set(r.id, r);
    this.version = 0;
    this._ordered = null;
  }

  get id() {
    return this.schema.id;
  }
  get name() {
    return this.schema.name;
  }
  get fields() {
    return this.schema.fields;
  }
  get views() {
    return this.schema.views;
  }
  get primary() {
    return this.field(this.schema.primaryFieldId) || this.schema.fields[0];
  }

  field(id) {
    return this.schema.fields.find((f) => f.id === id) || null;
  }
  fieldByName(name) {
    const n = String(name).trim().toLowerCase();
    return this.schema.fields.find((f) => f.name.toLowerCase() === n) || null;
  }
  view(id) {
    return this.schema.views.find((v) => v.id === id) || null;
  }
  record(id) {
    return this.records.get(id) || null;
  }

  /** Records in their manual order. Cached until something changes. */
  ordered() {
    if (!this._ordered) {
      this._ordered = [...this.records.values()].sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : 1));
    }
    return this._ordered;
  }

  touch() {
    this.version++;
    this._ordered = null;
  }

  maxOrder() {
    let m = 0;
    for (const r of this.records.values()) if (r.o > m) m = r.o;
    return m;
  }
}

/** Operations that change no cell, field or table: computed values stay. */
const VIEW_ONLY = new Set(['view.add', 'view.del', 'view.set', 'view.move', 'rec.meta', 'rec.order']);
function changesData(op) {
  return op.t === 'batch' ? op.ops.some(changesData) : !VIEW_ONLY.has(op.t);
}

export class Base extends Emitter {
  /**
   * doc: schema; records: { tableId: record[] }; opts.user: name stamped on
   * records; opts.now: clock (tests).
   */
  constructor(doc, records = {}, opts = {}) {
    super();
    this.doc = doc;
    this.user = opts.user || '';
    this.now = opts.now || (() => Date.now());
    this.tables = new Map();
    for (const t of doc.tables) this.tables.set(t.id, new Table(t, records[t.id] || []));
    this.undoStack = [];
    this.redoStack = [];
    this.version = 0;
    // Bumped only by changes computed values can depend on (not views or comments).
    this.dataVersion = 0;
    this.compute = new Compute(this);
    this._batch = null;
  }

  get id() {
    return this.doc.id;
  }
  get name() {
    return this.doc.name;
  }

  table(id) {
    return this.tables.get(id) || null;
  }
  tableList() {
    return this.doc.tables.map((t) => this.tables.get(t.id));
  }

  /** Display name of a record: its primary field as text. */
  recordName(tableId, recId) {
    const table = this.table(tableId);
    const rec = table?.record(recId);
    if (!rec) return '';
    const primary = table.primary;
    const v = this.compute.value(table, rec, primary);
    const s = toText(primary, v, this.compute.ctx);
    return s || 'Unnamed record';
  }

  /* ------------------------------------------------------------ history */

  /**
   * Apply an operation as one undoable step (or as part of the current
   * transaction). Returns the inverse.
   */
  apply(op, { undoable = true, label } = {}) {
    const change = { schema: false, records: new Map(), tables: new Set(), removedTables: new Set() };
    let inverse;
    try {
      inverse = this._apply(op, change);
    } finally {
      this._linkQueue = null;
    }
    this.version++;
    if (changesData(op)) this.dataVersion++;
    for (const tid of change.tables) this.tables.get(tid)?.touch();
    if (this._batch) {
      this._batch.inverses.push(inverse);
      mergeChange(this._batch.change, change);
    } else {
      if (undoable) {
        this.undoStack.push({ inverse, label: label || op.label || null });
        if (this.undoStack.length > 200) this.undoStack.shift();
        this.redoStack = [];
      }
      this.emit('change', change, op);
    }
    return inverse;
  }

  /** Group several operations into one undo step and one change event. */
  transact(fn, label) {
    if (this._batch) return fn();
    this._batch = { inverses: [], change: { schema: false, records: new Map(), tables: new Set(), removedTables: new Set() } };
    let result;
    try {
      result = fn();
    } finally {
      const batch = this._batch;
      this._batch = null;
      if (batch.inverses.length) {
        this.undoStack.push({ inverse: { t: 'batch', ops: batch.inverses.reverse() }, label: label || null });
        if (this.undoStack.length > 200) this.undoStack.shift();
        this.redoStack = [];
        this.emit('change', batch.change, { t: 'batch' });
      }
    }
    return result;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    const change = { schema: false, records: new Map(), tables: new Set(), removedTables: new Set() };
    const redo = this._apply(step.inverse, change);
    this.version++;
    if (changesData(step.inverse)) this.dataVersion++;
    for (const tid of change.tables) this.tables.get(tid)?.touch();
    this.redoStack.push({ inverse: redo, label: step.label });
    this.emit('change', change, step.inverse);
    return step;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    const change = { schema: false, records: new Map(), tables: new Set(), removedTables: new Set() };
    const undo = this._apply(step.inverse, change);
    this.version++;
    if (changesData(step.inverse)) this.dataVersion++;
    for (const tid of change.tables) this.tables.get(tid)?.touch();
    this.undoStack.push({ inverse: undo, label: step.label });
    this.emit('change', change, step.inverse);
    return step;
  }

  /* ---------------------------------------------------------- operations */

  _apply(op, ch) {
    switch (op.t) {
      case 'batch': {
        const inv = [];
        for (const o of op.ops) inv.push(this._apply(o, ch));
        return { t: 'batch', ops: inv.reverse() };
      }
      case 'base.set': {
        const old = {};
        for (const k of Object.keys(op.patch)) old[k] = clone(this.doc[k]);
        Object.assign(this.doc, clone(op.patch));
        ch.schema = true;
        return { t: 'base.set', patch: old };
      }
      case 'rec.add':
        return this._recAdd(op, ch);
      case 'rec.del':
        return this._recDel(op, ch);
      case 'rec.set':
        return this._recSet(op, ch);
      case 'rec.order': {
        const table = this.table(op.table);
        const old = [];
        for (const { id, o } of op.orders) {
          const r = table.record(id);
          if (!r) continue;
          old.push({ id, o: r.o });
          r.o = o;
          markRec(ch, table.id, id, 'order');
        }
        ch.tables.add(table.id);
        return { t: 'rec.order', table: op.table, orders: old };
      }
      case 'rec.meta': {
        // Record extras that are not cells (comments).
        const table = this.table(op.table);
        const rec = table.record(op.id);
        if (!rec) return { t: 'batch', ops: [] };
        const old = {};
        for (const k of Object.keys(op.patch)) old[k] = clone(rec[k]);
        for (const [k, v] of Object.entries(op.patch)) {
          if (v === undefined || v === null) delete rec[k];
          else rec[k] = clone(v);
        }
        markRec(ch, table.id, op.id);
        ch.tables.add(table.id);
        return { t: 'rec.meta', table: op.table, id: op.id, patch: old };
      }
      case 'table.add':
        return this._tableAdd(op, ch);
      case 'table.del':
        return this._tableDel(op, ch);
      case 'table.set': {
        const t = this.table(op.id);
        const old = {};
        for (const k of Object.keys(op.patch)) old[k] = clone(t.schema[k]);
        Object.assign(t.schema, clone(op.patch));
        ch.schema = true;
        ch.tables.add(t.id);
        return { t: 'table.set', id: op.id, patch: old };
      }
      case 'table.move': {
        const i = this.doc.tables.findIndex((t) => t.id === op.id);
        const [t] = this.doc.tables.splice(i, 1);
        this.doc.tables.splice(op.index, 0, t);
        ch.schema = true;
        return { t: 'table.move', id: op.id, index: i };
      }
      case 'field.add':
        return this._fieldAdd(op, ch);
      case 'field.del':
        return this._fieldDel(op, ch);
      case 'field.set':
        return this._fieldSet(op, ch);
      case 'field.move': {
        const t = this.table(op.table);
        const i = t.fields.findIndex((f) => f.id === op.id);
        const [f] = t.fields.splice(i, 1);
        t.fields.splice(op.index, 0, f);
        ch.schema = true;
        ch.tables.add(t.id);
        return { t: 'field.move', table: op.table, id: op.id, index: i };
      }
      case 'view.add': {
        const t = this.table(op.table);
        const index = op.index ?? t.views.length;
        t.views.splice(index, 0, clone(op.view));
        ch.schema = true;
        return { t: 'view.del', table: op.table, id: op.view.id };
      }
      case 'view.del': {
        const t = this.table(op.table);
        const i = t.views.findIndex((v) => v.id === op.id);
        const [v] = t.views.splice(i, 1);
        ch.schema = true;
        return { t: 'view.add', table: op.table, view: v, index: i };
      }
      case 'view.set': {
        const t = this.table(op.table);
        const v = t.view(op.id);
        const old = {};
        for (const k of Object.keys(op.patch)) old[k] = clone(v[k]);
        Object.assign(v, clone(op.patch));
        ch.schema = true;
        ch.views = ch.views || new Set();
        ch.views.add(op.id);
        return { t: 'view.set', table: op.table, id: op.id, patch: old };
      }
      case 'view.move': {
        const t = this.table(op.table);
        const i = t.views.findIndex((v) => v.id === op.id);
        const [v] = t.views.splice(i, 1);
        t.views.splice(op.index, 0, v);
        ch.schema = true;
        return { t: 'view.move', table: op.table, id: op.id, index: i };
      }
      default:
        throw new Error(`Unknown operation ${op.t}`);
    }
  }

  _recAdd(op, ch) {
    const table = this.table(op.table);
    const ids = [];
    for (const raw of op.recs) {
      const rec = clone(raw);
      table.records.set(rec.id, rec);
      ids.push(rec.id);
      markRec(ch, table.id, rec.id);
    }
    ch.tables.add(table.id);
    // Restore the other side of links.
    this._linkQueue = new Map();
    for (const f of table.fields) {
      if (f.type !== 'link') continue;
      for (const raw of op.recs) {
        const targets = raw.c?.[f.id];
        if (Array.isArray(targets) && targets.length) this._linkSides(table, f, raw.id, [], targets, ch);
      }
    }
    this._flushLinks(ch);
    return { t: 'rec.del', table: op.table, ids };
  }

  _recDel(op, ch) {
    const table = this.table(op.table);
    const removed = [];
    const idSet = new Set(op.ids);
    for (const id of op.ids) {
      const rec = table.record(id);
      if (!rec) continue;
      removed.push(clone(rec));
    }
    // Drop links pointing at removed records: symmetric links first, then
    // one-way links from anywhere in the base. The other side's lists are
    // kept as they were, so undo restores their order too.
    const seen = new Set();
    for (const rec of removed) {
      for (const f of table.fields) {
        const target = f.type === 'link' && f.options?.inverseId ? this.table(f.options.tableId) : null;
        if (!target) continue;
        for (const tid of rec.c?.[f.id] || []) {
          const key = `${target.id}:${tid}:${f.options.inverseId}`;
          const arr = target.record(tid)?.c[f.options.inverseId];
          if (seen.has(key) || idSet.has(tid) || !Array.isArray(arr)) continue;
          seen.add(key);
          (ch.oneWay ||= []).push({ table: target.id, id: tid, field: f.options.inverseId, prev: arr.slice() });
        }
      }
    }
    this._linkQueue = new Map();
    for (const rec of removed) {
      for (const f of table.fields) {
        if (f.type !== 'link') continue;
        const targets = rec.c?.[f.id];
        if (Array.isArray(targets) && targets.length) this._linkSides(table, f, rec.id, targets, [], ch);
      }
    }
    this._flushLinks(ch);
    for (const t of this.tables.values()) {
      for (const f of t.fields) {
        if (f.type !== 'link' || f.options?.tableId !== table.id || f.options?.inverseId) continue;
        for (const r of t.records.values()) {
          const arr = r.c[f.id];
          if (Array.isArray(arr) && arr.some((x) => idSet.has(x))) {
            // Recorded in the inverse so undo puts the reference back.
            const prev = arr.slice();
            r.c[f.id] = arr.filter((x) => !idSet.has(x));
            markRec(ch, t.id, r.id);
            ch.tables.add(t.id);
            (ch.oneWay ||= []).push({ table: t.id, id: r.id, field: f.id, prev });
          }
        }
      }
    }
    for (const rec of removed) {
      table.records.delete(rec.id);
      markRec(ch, table.id, rec.id, 'deleted');
    }
    ch.tables.add(table.id);
    const restoreOneWay = (ch.oneWay || []).splice(0);
    const inv = { t: 'rec.add', table: op.table, recs: removed };
    if (!restoreOneWay.length) return inv;
    const sets = new Map();
    for (const x of restoreOneWay) {
      if (!sets.has(x.table)) sets.set(x.table, []);
      sets.get(x.table).push({ id: x.id, cells: { [x.field]: x.prev } });
    }
    return { t: 'batch', ops: [inv, ...[...sets].map(([tid, changes]) => ({ t: 'rec.set', table: tid, changes, raw: true }))] };
  }

  _recSet(op, ch) {
    const table = this.table(op.table);
    const now = this.now();
    const old = [];
    // Small edits are kept in each record's history; bulk edits are not.
    const logHistory = !op.raw && op.changes.length <= HISTORY_BULK;
    this._linkQueue = op.raw ? null : new Map();
    for (const { id, cells } of op.changes) {
      const rec = table.record(id);
      if (!rec) continue;
      const prev = {};
      for (const [fid, value] of Object.entries(cells)) {
        const f = table.field(fid);
        // A cell this operation already changed from the other side.
        if (this._linkQueue?.size) this._flushLinks(ch, `${table.id}\u0000${fid}\u0000${id}`);
        prev[fid] = clone(rec.c[fid] ?? null);
        if (logHistory && f && JSON.stringify(prev[fid]) !== JSON.stringify(value ?? null)) {
          const text = (v) => cut(toText(f, v, this.compute.ctx));
          const entry = { t: now, by: this.user || '', f: fid, from: text(prev[fid]), to: text(value) };
          rec.h = [...(rec.h || []), entry].slice(-HISTORY_MAX);
        }
        if (f?.type === 'link' && !op.raw) {
          const before = Array.isArray(rec.c[fid]) ? rec.c[fid] : [];
          const after = Array.isArray(value) ? value : [];
          this._linkSides(table, f, id, before, after, ch);
        }
        if (value === null || value === undefined || (Array.isArray(value) && !value.length) || value === '' || value === false) delete rec.c[fid];
        else rec.c[fid] = clone(value);
      }
      old.push({ id, cells: prev, mt: rec.mt, mb: rec.mb });
      if (op.mt !== undefined) {
        rec.mt = op.mt;
        rec.mb = op.mb;
      } else if (!op.raw) {
        rec.mt = now;
        rec.mb = this.user || rec.mb;
      }
      markRec(ch, table.id, id);
    }
    this._flushLinks(ch);
    ch.tables.add(table.id);
    // The inverse restores the old modified stamp too.
    return { t: 'rec.set', table: op.table, changes: old.map(({ id, cells }) => ({ id, cells })), raw: op.raw, ...restoreStamp(old) };
  }

  /**
   * Update inverse link cells after a link cell went from before to after.
   * Inside an operation the updates are queued and applied once per target
   * record (_flushLinks), so linking many records to one costs O(n), not
   * O(n^2).
   */
  _linkSides(table, field, recId, before, after, ch) {
    const inverseId = field.options?.inverseId;
    const target = this.table(field.options?.tableId);
    if (!inverseId || !target) return;
    const own = !this._linkQueue;
    if (own) this._linkQueue = new Map();
    const b = new Set(before);
    const a = new Set(after);
    const queue = (tid, add) => {
      const key = `${target.id}\u0000${inverseId}\u0000${tid}`;
      let e = this._linkQueue.get(key);
      if (!e) this._linkQueue.set(key, (e = { table: target, field: inverseId, id: tid, ops: [] }));
      e.ops.push([recId, add]);
    };
    for (const tid of b) if (!a.has(tid)) queue(tid, false);
    for (const tid of a) if (!b.has(tid)) queue(tid, true);
    if (own) this._flushLinks(ch);
  }

  /** Apply queued inverse link updates (all, or one target cell's). */
  _flushLinks(ch, key = null) {
    const q = this._linkQueue;
    if (!q) return;
    const entries = key ? (q.has(key) ? [q.get(key)] : []) : [...q.values()];
    if (key) q.delete(key);
    else this._linkQueue = null;
    for (const e of entries) {
      const tr = e.table.record(e.id);
      if (!tr) continue;
      const cur = Array.isArray(tr.c[e.field]) ? tr.c[e.field] : [];
      const arr = [...cur];
      const set = new Set(arr);
      let removed = false;
      for (const [rid, add] of e.ops) {
        if (!add) removed = set.delete(rid) || removed;
        else if (!set.has(rid)) {
          arr.push(rid);
          set.add(rid);
        }
      }
      const seen = new Set();
      const next = removed ? arr.filter((x) => set.has(x) && !seen.has(x) && seen.add(x)) : arr;
      if (next.length) tr.c[e.field] = next;
      else delete tr.c[e.field];
      markRec(ch, e.table.id, e.id);
      ch.tables.add(e.table.id);
    }
  }

  _tableAdd(op, ch) {
    const schema = clone(op.schema);
    const index = op.index ?? this.doc.tables.length;
    this.doc.tables.splice(index, 0, schema);
    const table = new Table(schema, clone(op.recs || []));
    this.tables.set(schema.id, table);
    ch.schema = true;
    ch.tables.add(schema.id);
    for (const r of table.records.values()) markRec(ch, schema.id, r.id);
    return { t: 'table.del', id: schema.id };
  }

  _tableDel(op, ch) {
    const table = this.table(op.id);
    const index = this.doc.tables.findIndex((t) => t.id === op.id);
    const inverseOps = [];
    // Links from other tables into this one go with it.
    for (const t of this.tables.values()) {
      if (t.id === op.id) continue;
      for (const f of [...t.fields]) {
        if (f.type === 'link' && f.options?.tableId === op.id) {
          inverseOps.push(this._fieldDel({ t: 'field.del', table: t.id, id: f.id, keepInverse: true }, ch));
        }
      }
    }
    this.doc.tables.splice(index, 1);
    this.tables.delete(op.id);
    ch.schema = true;
    ch.removedTables.add(op.id);
    const restore = { t: 'table.add', schema: clone(table.schema), recs: clone([...table.records.values()]), index };
    return inverseOps.length ? { t: 'batch', ops: [restore, ...inverseOps.reverse()] } : restore;
  }

  _fieldAdd(op, ch) {
    const table = this.table(op.table);
    const field = clone(op.field);
    const index = op.index ?? table.fields.length;
    table.fields.splice(index, 0, field);
    if (op.values) {
      for (const [rid, v] of Object.entries(op.values)) {
        const rec = table.record(rid);
        if (!rec) continue;
        if (v === null || v === undefined) delete rec.c[field.id];
        else rec.c[field.id] = clone(v);
        markRec(ch, table.id, rid);
      }
    }
    ch.schema = true;
    ch.tables.add(table.id);
    return { t: 'field.del', table: op.table, id: field.id, keepInverse: true };
  }

  _fieldDel(op, ch) {
    const table = this.table(op.table);
    const index = table.fields.findIndex((f) => f.id === op.id);
    if (index < 0) return { t: 'batch', ops: [] };
    const field = table.fields[index];
    const values = {};
    for (const rec of table.records.values()) {
      if (field.id in rec.c) {
        values[rec.id] = clone(rec.c[field.id]);
        delete rec.c[field.id];
        markRec(ch, table.id, rec.id);
      }
    }
    table.fields.splice(index, 1);
    // Views forget the field.
    const viewPatches = [];
    for (const v of table.views) {
      const before = clone(v);
      if (scrubView(v, field.id)) viewPatches.push({ id: v.id, before });
    }
    ch.schema = true;
    ch.tables.add(table.id);
    const ops = [{ t: 'field.add', table: op.table, field: clone(field), index, values }];
    for (const { id, before } of viewPatches) ops.push({ t: 'view.set', table: op.table, id, patch: before });
    // The inverse side of a link goes too, unless the caller handles it.
    if (field.type === 'link' && field.options?.inverseId && !op.keepInverse) {
      const target = this.table(field.options.tableId);
      if (target?.field(field.options.inverseId)) {
        ops.push(this._fieldDel({ t: 'field.del', table: target.id, id: field.options.inverseId, keepInverse: true }, ch));
      }
    }
    return ops.length === 1 ? ops[0] : { t: 'batch', ops };
  }

  _fieldSet(op, ch) {
    const table = this.table(op.table);
    const field = table.field(op.id);
    const before = clone(field);
    const values = {};
    // Undo and redo give the whole field, so keys an edit added go again.
    const next = op.replace ? clone(op.patch) : { ...clone(field), ...clone(op.patch) };
    if (op.patch.options) next.options = { ...clone(op.patch.options) };
    // Changing type (or select choices) converts stored values.
    let converted = op.values || null;
    if (!converted && (op.patch.type && op.patch.type !== field.type)) {
      converted = {};
      const ctx = this.compute.ctx;
      // New options get distinct colors, counting ones made earlier in this
      // pass. Kept by name, with running color counts: thousands stay fast.
      const made = new Map();
      const counts = new Map(HUES.map((h) => [h, 0]));
      for (const c of next.options.choices || []) if (counts.has(c.color)) counts.set(c.color, counts.get(c.color) + 1);
      const choiceFor = (name) => {
        const lower = String(name).trim().toLowerCase();
        let c = made.get(lower);
        if (!c) {
          // The least used color, as makeChoice picks it.
          const color = HUES.reduce((best, h) => (counts.get(h) < counts.get(best) ? h : best));
          counts.set(color, counts.get(color) + 1);
          c = { ...makeChoice(name), color };
          made.set(lower, c);
        }
        return c;
      };
      for (const rec of table.records.values()) {
        const v = isComputed(field) ? this.compute.value(table, rec, field) : rec.c[field.id];
        // Errors (#DIV/0) are no data to keep.
        if (v === undefined || v === null || v.error) continue;
        converted[rec.id] = isComputed(next) ? null : convertValue(field, next, v, { ...ctx, makeChoice: choiceFor });
      }
      // Select conversions may have produced new choices.
      if (next.type === 'singleSelect' || next.type === 'multipleSelect') {
        const choices = next.options.choices || (next.options.choices = []);
        const ids = new Set(choices.map((c) => c.id));
        const byName = new Map();
        for (const c of choices) if (!byName.has(c.name)) byName.set(c.name, c);
        for (const [rid, v] of Object.entries(converted)) {
          if (v && typeof v === 'object' && 'newChoices' in v) {
            for (const c of v.newChoices) {
              if (ids.has(c.id) || byName.has(c.name)) continue;
              choices.push(c);
              ids.add(c.id);
              byName.set(c.name, c);
            }
            const remap = (id) => {
              const c = v.newChoices.find((x) => x.id === id);
              return c ? byName.get(c.name)?.id ?? id : id;
            };
            converted[rid] = Array.isArray(v.value) ? [...new Set(v.value.map(remap))] : v.value ? remap(v.value) : null;
          }
        }
      }
    }
    // Removing select choices clears them from cells.
    if (!converted && (next.type === 'singleSelect' || next.type === 'multipleSelect') && op.patch.options?.choices) {
      const keep = new Set(next.options.choices.map((c) => c.id));
      for (const rec of table.records.values()) {
        const v = rec.c[field.id];
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          const f = v.filter((x) => keep.has(x));
          if (f.length !== v.length) (converted ||= {})[rec.id] = f.length ? f : null;
        } else if (!keep.has(v)) (converted ||= {})[rec.id] = null;
      }
    }
    if (converted) {
      for (const [rid, v] of Object.entries(converted)) {
        const rec = table.record(rid);
        if (!rec) continue;
        values[rid] = clone(rec.c[field.id] ?? null);
        if (v === null || v === undefined || (Array.isArray(v) && !v.length) || v === false || v === '') delete rec.c[field.id];
        else rec.c[field.id] = clone(v);
        markRec(ch, table.id, rid);
      }
      // Computed fields keep nothing stored.
      if (isComputed(next)) {
        for (const rec of table.records.values()) {
          if (field.id in rec.c) {
            values[rec.id] = clone(rec.c[field.id]);
            delete rec.c[field.id];
            markRec(ch, table.id, rec.id);
          }
        }
      }
    }
    for (const k of Object.keys(field)) delete field[k];
    Object.assign(field, next);
    ch.schema = true;
    ch.tables.add(table.id);
    return { t: 'field.set', table: op.table, id: op.id, patch: before, replace: true, values: converted ? values : undefined };
  }

  /* --------------------------------------------------- friendly helpers */

  /** New record ids, created in a table with initial cells. */
  createRecords(tableId, cellsList, { after, before, label } = {}) {
    const table = this.table(tableId);
    let place = null;
    if (after || before) {
      const ordered = table.ordered();
      const i = ordered.findIndex((r) => r.id === (after || before));
      if (i >= 0) place = placeOrders(ordered, after ? i + 1 : i, cellsList.length);
    }
    if (!place) {
      const o0 = table.maxOrder() + 1;
      place = { orders: cellsList.map((_, i) => o0 + i), moved: [] };
    }
    return this._newRecords(table, cellsList, place, label || (cellsList.length === 1 ? 'Add record' : `Add ${cellsList.length} records`));
  }

  /** New records at the given orders, after moving others to make room (one undo step). */
  _newRecords(table, cellsList, { orders, moved }, label) {
    const tableId = table.id;
    const now = this.now();
    const autos = table.fields.filter((f) => f.type === 'autonumber');
    let nextNumber = table.schema.nextNumber || 1;
    const recs = cellsList.map((cells, i) => {
      const c = {};
      for (const [k, v] of Object.entries(cells || {})) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) c[k] = v;
      for (const f of autos) c[f.id] = nextNumber + i;
      // Defaults for new records.
      for (const f of table.fields) {
        if (c[f.id] !== undefined) continue;
        const d = f.options?.default;
        if (d === undefined || d === null || d === '') continue;
        if (f.type === 'date' && d === 'today') c[f.id] = dateKey(new Date(now));
        else c[f.id] = clone(d);
      }
      return { id: newId('rec'), c, o: orders[i], ct: now, mt: now, cb: this.user, mb: this.user };
    });
    const ops = [{ t: 'rec.add', table: tableId, recs }];
    if (moved.length) ops.unshift({ t: 'rec.order', table: tableId, orders: moved });
    if (autos.length || cellsList.length) {
      const n = nextNumber + recs.length;
      if (n !== table.schema.nextNumber) ops.push({ t: 'table.set', id: tableId, patch: { nextNumber: n } });
    }
    this.apply(ops.length === 1 ? ops[0] : { t: 'batch', ops }, { label });
    return recs.map((r) => r.id);
  }

  deleteRecords(tableId, ids) {
    if (!ids.length) return;
    this.apply({ t: 'rec.del', table: tableId, ids }, { label: ids.length === 1 ? 'Delete record' : `Delete ${ids.length} records` });
  }

  /** changes: [{ id, cells }] */
  setCells(tableId, changes, label) {
    if (!changes.length) return;
    this.apply({ t: 'rec.set', table: tableId, changes }, { label: label || 'Edit' });
  }

  setCell(tableId, recId, fieldId, value) {
    this.setCells(tableId, [{ id: recId, cells: { [fieldId]: value } }]);
  }

  duplicateRecords(tableId, ids) {
    const table = this.table(tableId);
    const cellsList = [];
    // Where each record's copies are in cellsList.
    const copies = new Map();
    for (const id of ids) {
      const rec = table.record(id);
      if (!rec) continue;
      const cells = {};
      for (const f of table.fields) {
        if (isComputed(f) || f.type === 'autonumber') continue;
        if (rec.c[f.id] !== undefined) cells[f.id] = clone(rec.c[f.id]);
      }
      if (!copies.has(id)) copies.set(id, []);
      copies.get(id).push(cellsList.length);
      cellsList.push(cells);
    }
    if (!cellsList.length) return [];
    // Copies go right after their records, placed in one pass over the table.
    const list = table.ordered();
    const orders = [];
    const moved = [];
    let room = true;
    for (let i = 0; i < list.length && room; i++) {
      const run = copies.get(list[i].id);
      if (!run) continue;
      const lo = list[i].o;
      const hi = i + 1 < list.length ? list[i + 1].o : lo + run.length + 1;
      const step = (hi - lo) / (run.length + 1);
      room = step > Math.max(1, Math.abs(lo), Math.abs(hi)) * 2 ** -32;
      run.forEach((k, j) => (orders[k] = lo + step * (j + 1)));
    }
    if (!room) {
      // A gap is too narrow: the table is numbered again in its new order.
      let n = 0;
      for (const r of list) {
        if (r.o !== ++n) moved.push({ id: r.id, o: n });
        for (const k of copies.get(r.id) || []) orders[k] = ++n;
      }
    }
    return this._newRecords(table, cellsList, { orders, moved }, ids.length === 1 ? 'Duplicate record' : 'Duplicate records');
  }

  moveRecords(tableId, ids, beforeId) {
    const table = this.table(tableId);
    const moving = new Set(ids);
    const rest = table.ordered().filter((r) => !moving.has(r.id));
    const i = beforeId ? rest.findIndex((r) => r.id === beforeId) : -1;
    const { orders, moved } = placeOrders(rest, i < 0 ? rest.length : i, ids.length);
    this.apply({ t: 'rec.order', table: tableId, orders: [...moved, ...ids.map((id, k) => ({ id, o: orders[k] }))] }, { label: 'Move records' });
  }

  addTable(name, { fields, recs, index } = {}) {
    const schema = makeTable(name, fields);
    this.apply({ t: 'table.add', schema, recs: recs || [], index }, { label: 'Add table' });
    return schema.id;
  }

  /**
   * Add a field. Link fields get an inverse field in the linked table
   * (except links to the same table).
   */
  addField(tableId, { name, type, options, description }, { index, values } = {}) {
    const table = this.table(tableId);
    const field = {
      id: newId('fld'),
      name: uniqueName(name || TYPES[type]?.label || 'Field', table.fields.map((f) => f.name)),
      type,
      options: { ...defaultOptions(type), ...clone(options || {}) },
    };
    if (description) field.description = description;
    const ops = [];
    if (type === 'link' && field.options.tableId && field.options.tableId !== tableId) {
      const target = this.table(field.options.tableId);
      const inv = {
        id: newId('fld'),
        name: uniqueName(table.name, target.fields.map((f) => f.name)),
        type: 'link',
        options: { tableId, inverseId: field.id, single: false },
      };
      field.options.inverseId = inv.id;
      // Links given with the field show on the other side too.
      let invValues;
      if (values) {
        invValues = {};
        for (const [rid, ids] of Object.entries(values)) for (const tid of ids || []) (invValues[tid] ||= []).push(rid);
      }
      ops.push({ t: 'field.add', table: target.id, field: inv, values: invValues });
    } else if (type === 'link') {
      field.options.inverseId = null;
    }
    if (type === 'autonumber') {
      const numbered = numberRecords(table);
      values = numbered.values;
      ops.push(numbered.op);
    }
    ops.unshift({ t: 'field.add', table: tableId, field, index, values });
    this.apply(ops.length === 1 ? ops[0] : { t: 'batch', ops }, { label: 'Add field' });
    return field.id;
  }

  /** Change a field's name, type, options or description. */
  updateField(tableId, fieldId, patch) {
    const table = this.table(tableId);
    const field = table.field(fieldId);
    if (patch.name !== undefined) patch.name = uniqueName(patch.name, table.fields.filter((f) => f.id !== fieldId).map((f) => f.name)) || field.name;
    if (patch.type && fieldId === table.schema.primaryFieldId && !PRIMARY_TYPES.has(patch.type)) {
      throw new Error(`The primary field can't be a ${TYPES[patch.type].label.toLowerCase()} field.`);
    }
    const ops = [];
    const before = clone(field);
    const toLink = patch.type === 'link' || (field.type === 'link' && !patch.type && patch.options?.tableId && patch.options.tableId !== field.options.tableId);
    const fromLink = field.type === 'link' && ((patch.type && patch.type !== 'link') || (patch.options?.tableId && patch.options.tableId !== field.options.tableId));
    if (fromLink && field.options.inverseId) {
      ops.push({ t: 'field.del', table: field.options.tableId, id: field.options.inverseId, keepInverse: true });
    }
    let values;
    if (toLink && patch.options?.tableId) {
      const targetId = patch.options.tableId;
      const target = this.table(targetId);
      // Text becomes links by matching names in the linked table.
      values = {};
      const names = new Map();
      for (const r of target.records.values()) {
        const n = this.recordName(targetId, r.id).trim().toLowerCase();
        if (!names.has(n)) names.set(n, r.id);
      }
      for (const rec of table.records.values()) {
        const v = field.type === 'link' ? null : this.compute.value(table, rec, field);
        if (v === null || v === undefined) {
          if (rec.c[fieldId] !== undefined) values[rec.id] = null;
          continue;
        }
        // A whole name first: "Beta, Inc" is one record, not two. Lists
        // (options, links) quote names with commas; other text is split on them.
        const whole = names.get(toText(field, v, this.compute.ctx).trim().toLowerCase());
        const parts = field.type === 'multipleSelect' || field.type === 'link' ? splitList(listText(field, v, this.compute.ctx)) : toText(field, v, this.compute.ctx).split(',');
        const ids = whole ? [whole] : parts.map((s) => names.get(s.trim().toLowerCase())).filter(Boolean);
        values[rec.id] = ids.length ? [...new Set(ids)] : null;
      }
      const options = { ...defaultOptions('link'), ...patch.options, inverseId: null };
      if (targetId !== tableId) {
        const inv = { id: newId('fld'), name: uniqueName(table.name, target.fields.map((f) => f.name)), type: 'link', options: { tableId, inverseId: fieldId, single: false } };
        options.inverseId = inv.id;
        const invValues = {};
        for (const [rid, ids] of Object.entries(values)) for (const tid of ids || []) (invValues[tid] ||= []).push(rid);
        ops.push({ t: 'field.add', table: targetId, field: inv, values: invValues });
      }
      patch = { ...patch, type: 'link', options };
      ops.push({ t: 'field.set', table: tableId, id: fieldId, patch, values });
    } else if (patch.type === 'autonumber' && field.type !== 'autonumber') {
      // Numbered like a new autonumber field, so new records go on from there.
      const numbered = numberRecords(table);
      ops.push({ t: 'field.set', table: tableId, id: fieldId, patch, values: numbered.values }, numbered.op);
    } else {
      ops.push({ t: 'field.set', table: tableId, id: fieldId, patch });
    }
    this.transact(() => {
      this.apply(ops.length === 1 ? ops[0] : { t: 'batch', ops });
      if (before.type !== field.type) this._refitConditions(table, field, before);
    }, 'Edit field');
  }

  /**
   * After a field changes type, filter and color conditions on it keep
   * their value when it still means the same (names become options and
   * back); otherwise they are reset to an empty condition, which filters
   * nothing, rather than hiding every record.
   */
  _refitConditions(table, field, before) {
    const ctx = this.compute.ctx;
    const kind = valueKind(field, ctx);
    const ops = OPERATORS[kind] || OPERATORS.text;
    const valid = new Set(ops.map(([k]) => k));
    const oldChoices = before.options?.choices || [];
    const choices = field.options?.choices || [];
    const byName = (n) => choices.find((c) => c.name.toLowerCase() === String(n).trim().toLowerCase())?.id;
    const nameOf = (id) => oldChoices.find((c) => c.id === id)?.name ?? id;
    const fit = (c) => {
      if (c.conditions) return { ...c, conditions: c.conditions.map(fit) };
      if (c.fieldId !== field.id) return c;
      if (NO_VALUE_OPS.has(c.op) && valid.has(c.op)) return c;
      let value = c.value;
      const list = Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value];
      if (kind === 'select' || kind === 'multi') {
        const ids = list.map((v) => (choices.some((x) => x.id === v) ? v : byName(nameOf(v)))).filter(Boolean);
        value = c.op === 'is' || c.op === 'isNot' ? ids[0] ?? null : ids;
      } else if (kind === 'text' && (before.type === 'singleSelect' || before.type === 'multipleSelect')) {
        value = list.length === 1 ? nameOf(list[0]) : null;
      } else if (kind === 'number') {
        value = list.length === 1 && (typeof list[0] === 'number' || (typeof list[0] === 'string' && list[0].trim() !== '' && !Number.isNaN(Number(list[0])))) ? list[0] : null;
      } else if (kind === 'date') {
        value = value && typeof value === 'object' && 'mode' in value ? value : null;
      } else if (kind === 'checkbox') {
        value = typeof value === 'boolean' ? value : null;
      } else if (typeof value !== 'string') value = null;
      // A different operator means something else: its value starts empty.
      const op = valid.has(c.op) ? c.op : ops[0][0];
      if (op !== c.op) value = null;
      if (op === c.op && value === c.value) return c;
      return { ...c, op, value: value === undefined || (Array.isArray(value) && !value.length) ? null : value };
    };
    for (const v of table.views) {
      const patch = {};
      if (v.filters?.conditions?.length) {
        const filters = fit(v.filters);
        if (JSON.stringify(filters) !== JSON.stringify(v.filters)) patch.filters = filters;
      }
      if (v.color?.rules?.length) {
        const rules = v.color.rules.map((r) => (r.filter ? { ...r, filter: fit(r.filter) } : r));
        if (JSON.stringify(rules) !== JSON.stringify(v.color.rules)) patch.color = { ...v.color, rules };
      }
      if (Object.keys(patch).length) this.apply({ t: 'view.set', table: table.id, id: v.id, patch });
    }
  }

  deleteField(tableId, fieldId) {
    const table = this.table(tableId);
    if (fieldId === table.schema.primaryFieldId) throw new Error("The primary field can't be deleted.");
    this.apply({ t: 'field.del', table: tableId, id: fieldId }, { label: 'Delete field' });
  }

  duplicateField(tableId, fieldId, withValues = true) {
    const table = this.table(tableId);
    const field = table.field(fieldId);
    const index = table.fields.indexOf(field) + 1;
    const values = {};
    if (withValues && !isComputed(field)) {
      for (const r of table.records.values()) if (r.c[fieldId] !== undefined) values[r.id] = clone(r.c[fieldId]);
    }
    const copy = { name: `${field.name} copy`, type: field.type, options: clone(field.options), description: field.description };
    if (field.type === 'link') copy.options.inverseId = null;
    // Values come with the field (links with their other side), so records
    // are not edited, and it is one undo step.
    return this.transact(() => this.addField(tableId, copy, { index, values }), 'Duplicate field');
  }

  addView(tableId, type, name, index) {
    const table = this.table(tableId);
    const view = createView(table, type, uniqueName(name, table.views.map((v) => v.name)));
    this.apply({ t: 'view.add', table: tableId, view, index }, { label: 'Add view' });
    return view.id;
  }

  updateView(tableId, viewId, patch, opts) {
    this.apply({ t: 'view.set', table: tableId, id: viewId, patch }, { label: 'Change view', ...opts });
  }
}

/* ------------------------------------------------------------- helpers */

/**
 * Mark a record 'changed', 'deleted' or 'order' (only its order changed, so
 * storage need not write its cells over newer ones saved elsewhere).
 */
function markRec(ch, tableId, recId, mark = 'changed') {
  let m = ch.records.get(tableId);
  if (!m) ch.records.set(tableId, (m = new Map()));
  setMark(m, recId, mark);
}

/** Set a record's mark; a record changed (or deleted) and then moved stays changed. */
export function setMark(m, recId, mark) {
  if (mark !== 'order' || !m.has(recId)) m.set(recId, mark);
}

function mergeChange(into, ch) {
  into.schema ||= ch.schema;
  for (const [tid, m] of ch.records) {
    let t = into.records.get(tid);
    if (!t) into.records.set(tid, (t = new Map()));
    for (const [rid, s] of m) setMark(t, rid, s);
  }
  for (const t of ch.tables) into.tables.add(t);
  for (const t of ch.removedTables) into.removedTables.add(t);
  if (ch.views) {
    into.views ||= new Set();
    for (const v of ch.views) into.views.add(v);
  }
}

/**
 * Orders for `count` records placed before list[i] (records in order; i
 * may be its length). Halving a gap runs out of precision after ~50
 * inserts at one spot, so when it is too narrow, the records around the
 * spot are spread out first, in a window widened until there is room:
 * `moved` gives their new orders.
 */
function placeOrders(list, i, count) {
  const len = list.length;
  for (let k = 0; ; k = k ? k * 2 : 8) {
    const a = Math.max(0, i - k);
    const b = Math.min(len, i + k);
    const slots = b - a + count;
    let lo = a > 0 ? list[a - 1].o : null;
    let hi = b < len ? list[b].o : null;
    if (lo === null && hi === null) [lo, hi] = [0, slots + 1];
    else if (lo === null) lo = hi - slots - 1;
    else if (hi === null) hi = lo + slots + 1;
    const step = (hi - lo) / (slots + 1);
    // Spreading leaves room for many more inserts before it is needed again.
    const room = Math.max(1, Math.abs(lo), Math.abs(hi)) * (k ? 2 ** -20 : 2 ** -32);
    if (step > room || (a === 0 && b === len)) {
      const orders = [];
      const moved = [];
      let pos = 0;
      for (let j = a; j <= b; j++) {
        if (j === i) for (let n = 0; n < count; n++) orders.push(lo + step * ++pos);
        if (j < b) moved.push({ id: list[j].id, o: lo + step * ++pos });
      }
      return { orders, moved };
    }
  }
}

/** Autonumbers for every record in the order they were made, and the table's next number. */
function numberRecords(table) {
  const values = {};
  let n = 1;
  for (const r of [...table.records.values()].sort((a, b) => a.ct - b.ct || a.o - b.o)) values[r.id] = n++;
  return { values, op: { t: 'table.set', id: table.id, patch: { nextNumber: Math.max(n, table.schema.nextNumber || 1) } } };
}

function restoreStamp(old) {
  // Single-record edits restore the exact stamp; batches keep the newest.
  if (old.length === 1) return { mt: old[0].mt, mb: old[0].mb };
  return {};
}

/** Remove a field from a view's settings. Returns whether anything changed. */
export function scrubView(v, fieldId) {
  let changed = false;
  const dropCond = (group) => {
    if (!group?.conditions) return;
    const before = group.conditions.length;
    group.conditions = group.conditions.filter((c) => (c.conditions ? (dropCond(c), true) : c.fieldId !== fieldId));
    if (group.conditions.length !== before) changed = true;
  };
  dropCond(v.filters);
  if (v.sorts?.some((s) => s.fieldId === fieldId)) {
    v.sorts = v.sorts.filter((s) => s.fieldId !== fieldId);
    changed = true;
  }
  if (v.groups?.some((s) => s.fieldId === fieldId)) {
    v.groups = v.groups.filter((s) => s.fieldId !== fieldId);
    changed = true;
  }
  for (const key of ['hidden', 'order']) {
    if (v[key]?.includes(fieldId)) {
      v[key] = v[key].filter((x) => x !== fieldId);
      changed = true;
    }
  }
  if (v.widths && fieldId in v.widths) {
    delete v.widths[fieldId];
    changed = true;
  }
  if (v.summaries && fieldId in v.summaries) {
    delete v.summaries[fieldId];
    changed = true;
  }
  for (const key of ['stackFieldId', 'dateFieldId', 'endFieldId', 'coverFieldId']) {
    if (v[key] === fieldId) {
      v[key] = null;
      changed = true;
    }
  }
  if (v.color?.fieldId === fieldId) {
    v.color = { type: 'none' };
    changed = true;
  }
  for (const r of v.color?.rules || []) dropCond(r.filter);
  if (v.form?.fields?.some((f) => f.id === fieldId)) {
    v.form.fields = v.form.fields.filter((f) => f.id !== fieldId);
    changed = true;
  }
  return changed;
}

export function uniqueName(name, taken) {
  const base = String(name || '').trim() || 'Untitled';
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

export function makeChoice(name, existing = []) {
  return { id: newId('sel'), name: String(name).trim(), color: nextColor(existing.map((c) => c.color)) };
}

/** A new table schema with a primary text field and a grid view. */
export function makeTable(name, fields) {
  const primary = { id: newId('fld'), name: 'Name', type: 'text', options: {} };
  const list = fields?.length ? fields.map((f) => ({ id: f.id || newId('fld'), name: f.name, type: f.type, options: { ...defaultOptions(f.type), ...(f.options || {}) }, ...(f.description ? { description: f.description } : {}) })) : [primary];
  const schema = { id: newId('tbl'), name: name || 'Table', primaryFieldId: list[0].id, fields: list, views: [], nextNumber: 1 };
  const table = new Table(schema);
  schema.views.push(createView(table, 'grid', 'Grid view'));
  return schema;
}

/** A blank base document: one table with a few starter fields. */
export function makeBaseDoc(name = 'Untitled base', { color = 'blue', icon = 'table' } = {}) {
  const fields = [
    { name: 'Name', type: 'text' },
    { name: 'Notes', type: 'longText' },
    { name: 'Status', type: 'singleSelect', options: { choices: [makeChoice('Todo', []), makeChoice('In progress', [{ color: 'blue' }]), makeChoice('Done', [{ color: 'blue' }, { color: 'cyan' }])] } },
  ];
  fields[2].options.choices[0].color = 'red';
  fields[2].options.choices[1].color = 'yellow';
  fields[2].options.choices[2].color = 'green';
  const table = makeTable('Table 1', fields);
  const now = Date.now();
  return { v: 1, id: newId('app'), name, color, icon, tables: [table], createdAt: now, updatedAt: now };
}
