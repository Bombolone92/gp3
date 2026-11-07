import RBush from 'rbush';
import { Emitter, uid } from './emitter.js';
import { bboxValid } from './geom.js';

const MAX_UNDO = 500;
const MERGE_WINDOW_MS = 1500;

/**
 * Holds the objects of one document (a schematic sheet, a board or a library
 * component) with a spatial index and undo history.
 *
 * Objects are immutable values: `update` replaces an object with a new one.
 * That makes undo cheap (the history keeps references, not copies) and lets
 * renderers compare by identity to find what changed.
 *
 * Every mutation happens inside `transact`, which records one undo step and
 * emits one 'change' event: { added, removed, updated, source }.
 */
export class ObjectStore extends Emitter {
  /** @param {{ bounds: (obj: object) => {minX,minY,maxX,maxY} }} opts */
  constructor({ bounds }) {
    super();
    this.bounds = bounds;
    this.objects = new Map();
    this.revision = 0;
    this.savedRevision = 0;
    this._index = new RBush(16);
    this._items = new Map();
    this._tx = null;
    this._undo = [];
    this._redo = [];
  }

  get size() { return this.objects.size; }
  get dirty() { return this.revision !== this.savedRevision; }
  markSaved() { this.savedRevision = this.revision; this.emit('saved'); }
  get(id) { return this.objects.get(id); }
  all() { return this.objects.values(); }
  [Symbol.iterator]() { return this.objects.values(); }

  /** Objects whose bounds intersect the box. */
  query(box) {
    const out = [];
    for (const item of this._index.search(box)) {
      const obj = this.objects.get(item.id);
      if (obj) out.push(obj);
    }
    return out;
  }

  /** Replaces all contents without recording history. */
  load(objects = []) {
    this.objects.clear();
    this._items.clear();
    this._index.clear();
    const items = [];
    for (const obj of objects) {
      this.objects.set(obj.id, obj);
      const item = this._itemFor(obj);
      if (item) { this._items.set(obj.id, item); items.push(item); }
    }
    this._index.load(items);
    this._undo = [];
    this._redo = [];
    this.revision = 0;
    this.savedRevision = 0;
    this.emit('change', { added: new Set(this.objects.keys()), removed: new Map(), updated: new Map(), source: 'load' });
  }

  /** Recomputes index entries (for example after a library symbol changed). */
  reindex(ids = this.objects.keys()) {
    const updated = new Map();
    for (const id of ids) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      this._unindex(id);
      this._indexObj(obj);
      updated.set(id, { before: obj, after: obj });
    }
    if (updated.size) this.emit('change', { added: new Set(), removed: new Map(), updated, source: 'reindex' });
  }

  _itemFor(obj) {
    const b = this.bounds(obj);
    if (!bboxValid(b)) return null;
    return { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, id: obj.id };
  }

  _indexObj(obj) {
    const item = this._itemFor(obj);
    if (item) { this._items.set(obj.id, item); this._index.insert(item); }
  }

  _unindex(id) {
    const item = this._items.get(id);
    if (item) { this._index.remove(item); this._items.delete(id); }
  }

  get inTransaction() { return this._tx !== null; }

  /**
   * Runs fn as one undoable step. Nested calls join the outer transaction.
   * With mergeKey, a step merges into the previous one when it has the same
   * key and happened moments ago (typing in a property field, nudging).
   */
  transact(label, fn, { mergeKey = null } = {}) {
    if (this._tx) return fn(this);
    this._tx = { label, changes: new Map() };
    let result;
    try {
      result = fn(this);
    } catch (err) {
      this._rollback();
      this._tx = null;
      throw err;
    }
    const tx = this._tx;
    this._tx = null;
    this._commit(tx, mergeKey);
    return result;
  }

  _record(id, before, after) {
    const ch = this._tx.changes.get(id);
    if (ch) ch.after = after;
    else this._tx.changes.set(id, { before, after });
  }

  _requireTx() {
    if (!this._tx) throw new Error('Edits must happen inside transact()');
  }

  add(obj) {
    this._requireTx();
    const o = obj.id ? obj : { ...obj, id: uid() };
    if (this.objects.has(o.id)) throw new Error(`Duplicate id ${o.id}`);
    this.objects.set(o.id, o);
    this._indexObj(o);
    this._record(o.id, null, o);
    return o;
  }

  /** patch is an object of fields to replace or a function old -> new. */
  update(id, patch) {
    this._requireTx();
    const old = this.objects.get(id);
    if (!old) return null;
    const next = typeof patch === 'function' ? patch(old) : { ...old, ...patch };
    if (next === old) return old;
    next.id = id;
    this.objects.set(id, next);
    this._unindex(id);
    this._indexObj(next);
    this._record(id, old, next);
    return next;
  }

  remove(id) {
    this._requireTx();
    const old = this.objects.get(id);
    if (!old) return null;
    this.objects.delete(id);
    this._unindex(id);
    this._record(id, old, null);
    return old;
  }

  _rollback() {
    for (const [id, { before }] of this._tx.changes) this._put(id, before);
  }

  _put(id, value) {
    this._unindex(id);
    if (value) { this.objects.set(id, value); this._indexObj(value); } else this.objects.delete(id);
  }

  _commit(tx, mergeKey) {
    // Drop no-op entries (added then removed in the same step).
    for (const [id, ch] of tx.changes) if (ch.before === ch.after) tx.changes.delete(id);
    if (!tx.changes.size) return;
    const now = Date.now();
    const last = this._undo[this._undo.length - 1];
    if (mergeKey && last && last.mergeKey === mergeKey && now - last.time < MERGE_WINDOW_MS) {
      for (const [id, ch] of tx.changes) {
        const prev = last.changes.get(id);
        if (prev) prev.after = ch.after; else last.changes.set(id, ch);
      }
      last.time = now;
    } else {
      this._undo.push({ label: tx.label, changes: tx.changes, mergeKey, time: now });
      if (this._undo.length > MAX_UNDO) this._undo.shift();
    }
    this._redo = [];
    this.revision++;
    this._emitChanges(tx.changes, 'edit');
  }

  _emitChanges(changes, source) {
    const added = new Set(), removed = new Map(), updated = new Map();
    for (const [id, { before, after }] of changes) {
      if (!before && after) added.add(id);
      else if (before && !after) removed.set(id, before);
      else if (before && after) updated.set(id, { before, after });
    }
    this.emit('change', { added, removed, updated, source });
  }

  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  get undoLabel() { return this._undo[this._undo.length - 1]?.label ?? null; }
  get redoLabel() { return this._redo[this._redo.length - 1]?.label ?? null; }

  undo() {
    const step = this._undo.pop();
    if (!step) return false;
    const inverse = new Map();
    for (const [id, { before, after }] of step.changes) {
      this._put(id, before);
      inverse.set(id, { before: after, after: before });
    }
    this._redo.push(step);
    this.revision++;
    this._emitChanges(inverse, 'undo');
    return true;
  }

  redo() {
    const step = this._redo.pop();
    if (!step) return false;
    for (const [id, { after }] of step.changes) this._put(id, after);
    this._undo.push(step);
    this.revision++;
    this._emitChanges(step.changes, 'redo');
    return true;
  }

  clearHistory() { this._undo = []; this._redo = []; }
}
