/**
 * Values of computed fields (formula, lookup, rollup, count, created and
 * modified stamps). Values are computed when first asked for and cached
 * until the base's data changes, so painting a grid only computes visible cells
 * while filters and sorts over computed fields compute each record once.
 */
import { prepare, inferKind, toNum, toStr, isStackOverflow } from './formula.js';
import { valueKind, isEmpty, findChoice } from './fields.js';
import { toDate, dateKey, isDateOnly } from '../lib/format.js';

const ERR = (code, message) => ({ error: code, message });

export class Compute {
  constructor(base) {
    this.base = base;
    this.cache = new Map();
    this.programs = new Map();
    this.stack = new Map();
    this.ctx = {
      recordName: (tableId, id) => base.recordName(tableId, id),
      formulaKind: (field) => this.formulaKind(field),
      lookupTarget: (field) => this.lookupTarget(field),
      findRecords: (tableId, names) => this.findRecords(tableId, names),
    };
  }

  /** The value of a field for a record. */
  value(table, rec, field) {
    if (!field || !rec) return null;
    switch (field.type) {
      case 'formula':
      case 'lookup':
      case 'rollup':
      case 'count':
        return this.cached(table, rec, field);
      case 'createdTime':
        return rec.ct ? new Date(rec.ct).toISOString() : null;
      case 'lastModifiedTime':
        return rec.mt || rec.ct ? new Date(rec.mt || rec.ct).toISOString() : null;
      case 'createdBy':
        return rec.cb || null;
      case 'lastModifiedBy':
        return rec.mb || rec.cb || null;
      case 'button':
        return field.options?.label || 'Open';
      default: {
        const v = rec.c[field.id];
        return v === undefined ? null : v;
      }
    }
  }

  cached(table, rec, field) {
    let entry = this.cache.get(field.id);
    // Values also expire each minute: TODAY() and NOW() move on without edits.
    const minute = Math.floor(this.base.now() / 60000);
    if (!entry || entry.version !== this.base.dataVersion || entry.minute !== minute) {
      entry = { version: this.base.dataVersion, minute, values: new Map() };
      this.cache.set(field.id, entry);
    }
    if (entry.values.has(rec.id)) return entry.values.get(rec.id);
    const key = `${field.id}:${rec.id}`;
    if (this.stack.has(key)) return ERR('#CYCLE', 'This formula refers back to itself.');
    const top = !this.stack.size;
    if (top) this.deepest = null;
    this.stack.set(key, [table, rec, field]);
    let v;
    let overflow = false;
    try {
      v = this.computeValue(table, rec, field);
    } catch (err) {
      if (!isStackOverflow(err)) throw err;
      // The values in progress where the stack ran out, outermost first.
      this.deepest ||= [...this.stack.values()];
      if (!top) throw err;
      overflow = true;
    } finally {
      this.stack.delete(key);
    }
    if (overflow) return this.computeDeepFirst(table, rec, field, entry);
    entry.values.set(rec.id, v);
    return v;
  }

  /**
   * Long chains of linked records (a running balance over thousands of
   * records) run out of stack. Then the values that were in progress are
   * computed deepest first, each on a fresh stack, and the value again.
   */
  computeDeepFirst(table, rec, field, entry) {
    const path = this.deepest;
    this.deepest = null;
    if (!path || path.length < 2) {
      const v = ERR('#ERROR', 'This value is nested too deeply to compute.');
      entry.values.set(rec.id, v);
      return v;
    }
    for (let i = path.length - 1; i > 0; i--) this.cached(...path[i]);
    return this.cached(table, rec, field);
  }

  computeValue(table, rec, field) {
    const o = field.options || {};
    switch (field.type) {
      case 'formula':
        return this.formula(table, rec, field);
      case 'count': {
        const link = table.field(o.linkFieldId);
        if (!link || link.type !== 'link') return ERR('#CONFIG', 'Choose a linked field to count.');
        const ids = rec.c[link.id];
        return Array.isArray(ids) ? ids.filter((id) => this.base.table(link.options.tableId)?.record(id)).length : 0;
      }
      case 'lookup': {
        const values = this.linkedValues(table, rec, o.linkFieldId, o.targetFieldId);
        return values === null ? ERR('#CONFIG', 'Choose a linked field and a field to look up.') : cycleIn(values) || values;
      }
      case 'rollup': {
        // Empty values count: an unchecked box makes "All true" false.
        const values = this.linkedValues(table, rec, o.linkFieldId, o.targetFieldId, { blanks: true });
        if (values === null) return ERR('#CONFIG', 'Choose a linked field and a field to summarize.');
        const target = this.rollupTarget(table, field);
        // Looked-up options and records by name, not id.
        const items = target.type === 'lookup' ? values.map((v) => (Array.isArray(v) ? this.lookupItems(target, v) : v)) : values;
        return rollup(o.fn, items, target, (tid, id) => this.base.recordName(tid, id));
      }
      default:
        return null;
    }
  }

  /**
   * Raw values of a field across the records linked through a link field;
   * with blanks, empty values are included as null.
   */
  linkedValues(table, rec, linkFieldId, targetFieldId, { blanks = false } = {}) {
    const link = table.field(linkFieldId);
    if (!link || link.type !== 'link') return null;
    const target = this.base.table(link.options.tableId);
    const tf = target?.field(targetFieldId);
    if (!tf) return null;
    const ids = rec.c[link.id];
    if (!Array.isArray(ids)) return [];
    const out = [];
    for (const id of ids) {
      const r = target.record(id);
      if (!r) continue;
      const v = this.value(target, r, tf);
      if (v === null || v === undefined) {
        if (blanks) out.push(null);
        continue;
      }
      out.push(v);
    }
    return out;
  }

  lookupTarget(field) {
    for (const table of this.base.tables.values()) {
      if (!table.field(field.id)) continue;
      const link = table.field(field.options?.linkFieldId);
      const target = link && this.base.table(link.options?.tableId);
      return target?.field(field.options?.targetFieldId) || null;
    }
    return null;
  }

  rollupTarget(table, field) {
    const link = table.field(field.options?.linkFieldId);
    const target = link && this.base.table(link.options?.tableId);
    return target?.field(field.options?.targetFieldId) || null;
  }

  /* ------------------------------------------------------------ formulas */

  program(table, field) {
    const src = field.options?.formula || '';
    let p = this.programs.get(field.id);
    if (!p || p.src !== src) {
      p = { src, ...prepare(src), kind: null, kindVersion: -1 };
      this.programs.set(field.id, p);
    }
    return p;
  }

  formula(table, rec, field) {
    const p = this.program(table, field);
    if (p.error) return ERR('#ERROR', p.error);
    const base = this.base;
    const self = this;
    const ctx = {
      record: rec,
      now: () => new Date(base.now()),
      get(id) {
        const f = table.field(id);
        if (!f) throw Object.assign(new Error('A field this formula uses was deleted.'), { code: '#REF' });
        return self.formulaValue(table, rec, f);
      },
    };
    try {
      let v = p.run(ctx);
      if (typeof v === 'number' && !Number.isFinite(v)) return ERR('#NUM', 'The result is not a finite number.');
      if (v && typeof v === 'object' && v.error) return v;
      if (Array.isArray(v)) v = v.map((x) => (x && typeof x === 'object' && x.error ? x.error : x));
      return v === undefined ? null : v;
    } catch (err) {
      if (isStackOverflow(err)) throw err;
      return ERR(err.code || '#ERROR', err.message);
    }
  }

  /** A field's value as formulas see it: names instead of ids. */
  formulaValue(table, rec, f) {
    const v = this.value(table, rec, f);
    if (v && typeof v === 'object' && !Array.isArray(v) && v.error) {
      throw Object.assign(new Error(v.message || v.error), { code: v.error });
    }
    switch (f.type) {
      case 'singleSelect':
        return v ? f.options.choices.find((c) => c.id === v)?.name ?? null : null;
      case 'multipleSelect':
        return Array.isArray(v) ? v.map((id) => f.options.choices.find((c) => c.id === id)?.name).filter(Boolean) : [];
      case 'link':
        return Array.isArray(v) ? v.map((id) => this.base.recordName(f.options.tableId, id)) : [];
      case 'attachment':
        return Array.isArray(v) ? v.map((a) => a.name) : [];
      case 'checkbox':
        return !!v;
      case 'date': {
        // A date field without times shows (and gives formulas) only the
        // date, also for values stored while it included times.
        if (!v || f.options?.includeTime || isDateOnly(v)) return v;
        const d = toDate(v);
        if (!d) return v;
        return f.options?.gmt ? d.toISOString().slice(0, 10) : dateKey(d);
      }
      case 'lookup': {
        const target = this.lookupTarget(f);
        if (!Array.isArray(v)) return [];
        // An error in a linked record is the formula's error too.
        const err = errorIn(v);
        if (err) throw Object.assign(new Error(err.message || err.error), { code: err.error });
        if (!target) return v;
        return v.flatMap((x) => this.lookupItems(target, x));
      }
      default:
        return v;
    }
  }

  /**
   * Formula items for one looked-up value of a field: option and record
   * names (whole, even with commas), file names, through lookups of lookups.
   */
  lookupItems(target, x) {
    if (x === null || x === undefined) return [];
    const choice = (id) => target.options.choices?.find((c) => c.id === id)?.name;
    switch (target.type) {
      case 'singleSelect':
        return choice(x) ? [choice(x)] : [];
      case 'multipleSelect':
        return Array.isArray(x) ? x.map(choice).filter(Boolean) : [];
      case 'link':
        return Array.isArray(x) ? x.map((id) => this.base.recordName(target.options.tableId, id)) : [];
      case 'attachment':
        return Array.isArray(x) ? x.map((a) => a.name) : [];
      case 'lookup': {
        const inner = this.lookupTarget(target);
        if (!Array.isArray(x)) return [];
        return inner ? x.flatMap((y) => this.lookupItems(inner, y)) : x.flat(Infinity);
      }
      default:
        return Array.isArray(x) ? x.flat(Infinity) : [x];
    }
  }

  /** The kind of value a formula field produces (number, text, date, ...). */
  formulaKind(field) {
    const table = [...this.base.tables.values()].find((t) => t.field(field.id));
    if (!table) return 'text';
    const p = this.program(table, field);
    if (!p.ast) return 'text';
    if (p.kindVersion === this.base.dataVersion) return p.kind;
    const seen = new Set([field.id]);
    const kindOf = (id) => {
      const f = table.field(id);
      if (!f) return 'text';
      if (f.type === 'formula') {
        if (seen.has(f.id)) return 'text';
        seen.add(f.id);
        const q = this.program(table, f);
        return q.ast ? inferKind(q.ast, kindOf) : 'text';
      }
      if (f.type === 'lookup') {
        const t = this.lookupTarget(f);
        const k = t ? valueKind(t, this.ctx) : 'text';
        return k === 'number' ? 'list' : 'list';
      }
      return valueKind(f, this.ctx);
    };
    p.kind = inferKind(p.ast, kindOf);
    p.kindVersion = this.base.dataVersion;
    return p.kind;
  }

  /**
   * Record ids in a table whose names match, for pasting into links. The
   * name index is kept until the base changes: a paste or import looks up
   * every cell.
   */
  findRecords(tableId, names) {
    const table = this.base.table(tableId);
    if (!table) return [];
    const wanted = names.map((n) => n.trim().toLowerCase());
    this.nameIndex ||= new Map();
    let cached = this.nameIndex.get(tableId);
    if (!cached || cached.version !== this.base.dataVersion) {
      const index = new Map();
      for (const r of table.records.values()) {
        const n = this.base.recordName(tableId, r.id).trim().toLowerCase();
        if (!index.has(n)) index.set(n, r.id);
      }
      this.nameIndex.set(tableId, (cached = { version: this.base.dataVersion, index }));
    }
    const index = cached.index;
    const out = [];
    for (const w of wanted) {
      const id = index.get(w);
      if (id && !out.includes(id)) out.push(id);
    }
    return out;
  }
}

/**
 * A reference cycle met through linked records. It is passed on, so every
 * field in the cycle shows #CYCLE instead of a value that depends on which
 * one was computed first.
 */
function cycleIn(values) {
  return errorIn(values, '#CYCLE');
}

/** The first error (of a code, or any) among values, nested or not. */
function errorIn(values, code) {
  for (const v of values.flat(Infinity)) if (v && typeof v === 'object' && v.error && (!code || v.error === code)) return v;
  return null;
}

/** Summarize linked values for a rollup field. */
export function rollup(fn, values, target, recordName = (tid, id) => id) {
  // An error in a linked record shows, not a total that quietly leaves it out.
  const err = errorIn(values);
  if (err) return err;
  const flatVals = values.flat(Infinity).filter((v) => v !== null && v !== undefined);
  const numbers = () => flatVals.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : toNum(v))).filter((n) => Number.isFinite(n));
  const asText = (v) => {
    if (target && (target.type === 'singleSelect' || target.type === 'multipleSelect')) {
      return target.options.choices.find((c) => c.id === v)?.name ?? toStr(v);
    }
    // Linked records and files by name, not id or object.
    if (target?.type === 'link') return recordName(target.options.tableId, v);
    if (target?.type === 'attachment') return v?.name ?? '';
    return toStr(v);
  };
  switch (fn) {
    case 'sum':
      return numbers().reduce((a, b) => a + b, 0);
    case 'avg': {
      const xs = numbers();
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    }
    case 'min': {
      const xs = numbers();
      // Loops, not Math.min(...xs): spreading 100k values overflows the stack.
      return xs.length ? xs.reduce((m, x) => (x < m ? x : m)) : null;
    }
    case 'max': {
      const xs = numbers();
      return xs.length ? xs.reduce((m, x) => (x > m ? x : m)) : null;
    }
    case 'count':
      return flatVals.filter((v) => typeof v === 'number').length || numbers().length;
    case 'countAll':
      return values.length;
    case 'countUnique':
      return new Set(flatVals.filter((v) => !isEmpty(v)).map(asText)).size;
    case 'concat':
      return flatVals.filter((v) => !isEmpty(v)).map(asText).join(', ');
    case 'unique':
      return [...new Set(flatVals.filter((v) => !isEmpty(v)).map(asText))];
    case 'and':
      return values.length > 0 && values.every((v) => (Array.isArray(v) ? v.length > 0 && v.flat(Infinity).every(Boolean) : !!v));
    case 'or':
      return flatVals.some(Boolean);
    case 'earliest':
    case 'latest': {
      const ds = flatVals.filter((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)).sort();
      if (!ds.length) return null;
      return fn === 'earliest' ? ds[0] : ds[ds.length - 1];
    }
    default:
      return null;
  }
}

export { findChoice };
