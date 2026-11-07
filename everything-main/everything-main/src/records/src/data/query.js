/**
 * Filtering, sorting, grouping and searching records for a view.
 *
 * Sort keys are computed once per record and sorted with a typed
 * comparator, so sorting 100k records by a formula costs 100k formula
 * evaluations and a native sort, not n log n evaluations.
 */
import { valueKind, toText, isEmpty } from './fields.js';
import { toDate, shownDate, startOfDay, isNum, parseNumber, parseDuration } from '../lib/format.js';
import { visibleFields } from './views.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/* ------------------------------------------------------------ operators */

export const OPERATORS = {
  text: [
    ['contains', 'contains'], ['doesNotContain', 'does not contain'], ['is', 'is'], ['isNot', 'is not'],
    ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
  number: [
    ['=', '='], ['!=', '≠'], ['<', '<'], ['>', '>'], ['<=', '≤'], ['>=', '≥'],
    ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
  select: [
    ['is', 'is'], ['isNot', 'is not'], ['isAnyOf', 'is any of'], ['isNoneOf', 'is none of'],
    ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
  multi: [
    ['hasAnyOf', 'has any of'], ['hasAllOf', 'has all of'], ['isExactly', 'is exactly'], ['hasNoneOf', 'has none of'],
    ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
  checkbox: [['is', 'is']],
  date: [
    ['is', 'is'], ['isBefore', 'is before'], ['isAfter', 'is after'], ['isOnOrBefore', 'is on or before'],
    ['isOnOrAfter', 'is on or after'], ['isWithin', 'is within'], ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
  link: [
    ['contains', 'contains'], ['doesNotContain', 'does not contain'], ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
  attachment: [
    ['filenameContains', 'filename contains'], ['hasFileType', 'has file type'], ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
  list: [
    ['contains', 'contains'], ['doesNotContain', 'does not contain'], ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'],
  ],
};

export const NO_VALUE_OPS = new Set(['isEmpty', 'isNotEmpty']);

export const DATE_MODES = {
  today: 'today', tomorrow: 'tomorrow', yesterday: 'yesterday', oneWeekAgo: 'one week ago', oneWeekFromNow: 'one week from now',
  oneMonthAgo: 'one month ago', oneMonthFromNow: 'one month from now', daysAgo: 'number of days ago',
  daysFromNow: 'number of days from now', exactDate: 'exact date',
};

export const WITHIN_MODES = {
  pastWeek: 'the past week', pastMonth: 'the past month', pastYear: 'the past year', nextWeek: 'the next week',
  nextMonth: 'the next month', nextYear: 'the next year', pastDays: 'the past number of days', nextDays: 'the next number of days',
};

export const FILE_TYPES = { image: 'Image', text: 'Text', pdf: 'PDF', video: 'Video', audio: 'Audio', spreadsheet: 'Spreadsheet' };

export function operatorsFor(field, ctx) {
  return OPERATORS[valueKind(field, ctx)] || OPERATORS.text;
}

export function defaultOp(field, ctx) {
  return operatorsFor(field, ctx)[0][0];
}

/** A condition is ignored until it has what it needs. */
export function isActive(cond) {
  if (!cond || !cond.fieldId || !cond.op) return false;
  if (NO_VALUE_OPS.has(cond.op)) return true;
  const v = cond.value;
  if (cond.op === 'is' && typeof v === 'boolean') return true;
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object' && 'mode' in v) {
    if (v.mode === 'exactDate') return !!v.date;
    if (v.mode === 'daysAgo' || v.mode === 'daysFromNow' || v.mode === 'pastDays' || v.mode === 'nextDays') return isNum(v.n);
    return true;
  }
  return true;
}

/**
 * The start of the local day some days and months from d's day. Built from
 * the date parts: where clocks change at midnight a day starts at 1:00, and
 * adding days to that time would carry it into the next day.
 */
function dayFrom(d, days = 0, months = 0) {
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last) + days);
}

function resolveDate(v, now) {
  switch (v?.mode) {
    case 'today':
      return dayFrom(now);
    case 'tomorrow':
      return dayFrom(now, 1);
    case 'yesterday':
      return dayFrom(now, -1);
    case 'oneWeekAgo':
      return dayFrom(now, -7);
    case 'oneWeekFromNow':
      return dayFrom(now, 7);
    case 'oneMonthAgo':
      return dayFrom(now, 0, -1);
    case 'oneMonthFromNow':
      return dayFrom(now, 0, 1);
    case 'daysAgo':
      return dayFrom(now, -(v.n || 0));
    case 'daysFromNow':
      return dayFrom(now, v.n || 0);
    case 'exactDate':
      return v.date && toDate(v.date) ? dayFrom(toDate(v.date)) : null;
    default:
      return null;
  }
}

function withinRange(v, now) {
  const today = dayFrom(now);
  const tomorrow = dayFrom(now, 1);
  switch (v?.mode) {
    case 'pastWeek':
      return [dayFrom(now, -7), tomorrow];
    case 'pastMonth':
      return [dayFrom(now, 0, -1), tomorrow];
    case 'pastYear':
      return [dayFrom(now, 0, -12), tomorrow];
    case 'nextWeek':
      return [today, dayFrom(now, 8)];
    case 'nextMonth':
      return [today, dayFrom(now, 1, 1)];
    case 'nextYear':
      return [today, dayFrom(now, 1, 12)];
    case 'pastDays':
      return [dayFrom(now, -(v.n || 0)), tomorrow];
    case 'nextDays':
      return [today, dayFrom(now, (v.n || 0) + 1)];
    default:
      return null;
  }
}

function fileKind(a) {
  const t = String(a.type || '');
  const n = String(a.name || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/\.(csv|xlsx?|ods|numbers|tsv)$/.test(n)) return 'spreadsheet';
  if (t.startsWith('text/') || /\.(txt|md|rtf|docx?)$/.test(n)) return 'text';
  return 'other';
}

/**
 * Build a predicate for a single condition. Text comparisons ignore case.
 */
function conditionTest(base, table, cond, now) {
  const field = table.field(cond.fieldId);
  if (!field) return null;
  const compute = base.compute;
  const ctx = compute.ctx;
  const kind = valueKind(field, ctx);
  const op = cond.op;
  const val = (rec) => compute.value(table, rec, field);
  const text = (rec) => toText(field, val(rec), ctx).toLowerCase();
  if (op === 'isEmpty') return (rec) => isEmptyValue(val(rec));
  if (op === 'isNotEmpty') return (rec) => !isEmptyValue(val(rec));
  const q = cond.value;
  switch (kind) {
    case 'number': {
      const target = filterNumber(field, q);
      if (target === null) return null;
      // Values within a hair of the target (0.1 + 0.2 and 0.3) are equal for every operator.
      return (rec) => {
        const v = val(rec);
        if (!isNum(v)) return op === '!=';
        switch (op) {
          case '=':
            return Math.abs(v - target) < 1e-9;
          case '!=':
            return Math.abs(v - target) >= 1e-9;
          case '<':
            return v < target - 1e-9;
          case '>':
            return v > target + 1e-9;
          case '<=':
            return v <= target + 1e-9;
          case '>=':
            return v >= target - 1e-9;
          default:
            return true;
        }
      };
    }
    case 'checkbox':
      return (rec) => !!val(rec) === !!q;
    case 'select': {
      const ids = Array.isArray(q) ? q : [q];
      if (field.type === 'formula' || field.type === 'rollup') return null;
      switch (op) {
        case 'is':
          return (rec) => val(rec) === ids[0];
        case 'isNot':
          return (rec) => val(rec) !== ids[0];
        case 'isAnyOf':
          return (rec) => ids.includes(val(rec));
        case 'isNoneOf':
          return (rec) => !ids.includes(val(rec));
        default:
          return null;
      }
    }
    case 'multi': {
      const ids = Array.isArray(q) ? q : [q];
      return (rec) => {
        const v = val(rec) || [];
        switch (op) {
          case 'hasAnyOf':
            return ids.some((id) => v.includes(id));
          case 'hasAllOf':
            return ids.every((id) => v.includes(id));
          case 'isExactly':
            return v.length === ids.length && ids.every((id) => v.includes(id));
          case 'hasNoneOf':
            return !ids.some((id) => v.includes(id));
          default:
            return true;
        }
      };
    }
    case 'date': {
      // Times shown in GMT are compared by the GMT date the cell shows.
      const gmt = !!field.options?.gmt;
      const shown = (rec) => shownDate(val(rec), gmt);
      if (op === 'isWithin') {
        const range = withinRange(q, now);
        if (!range) return null;
        const [lo, hi] = range;
        return (rec) => {
          const d = shown(rec);
          return !!d && d >= lo && d < hi;
        };
      }
      const day = resolveDate(q, now);
      if (!day) return null;
      const next = dayFrom(day, 1);
      return (rec) => {
        const d = shown(rec);
        if (!d) return false;
        switch (op) {
          case 'is':
            return d >= day && d < next;
          case 'isBefore':
            return d < day;
          case 'isAfter':
            return d >= next;
          case 'isOnOrBefore':
            return d < next;
          case 'isOnOrAfter':
            return d >= day;
          default:
            return true;
        }
      };
    }
    case 'attachment': {
      if (op === 'hasFileType') return (rec) => (val(rec) || []).some((a) => fileKind(a) === q);
      const s = String(q).toLowerCase();
      return (rec) => (val(rec) || []).some((a) => String(a.name).toLowerCase().includes(s));
    }
    default: {
      const s = String(q).toLowerCase().trim();
      switch (op) {
        case 'contains':
          return (rec) => text(rec).includes(s);
        case 'doesNotContain':
          return (rec) => !text(rec).includes(s);
        case 'is':
          return (rec) => text(rec).trim() === s;
        case 'isNot':
          return (rec) => text(rec).trim() !== s;
        default:
          return null;
      }
    }
  }
}

/** A number filter's value, read the way the field shows numbers. */
function filterNumber(field, q) {
  if (typeof q === 'number') return q;
  const format = field.type === 'formula' ? field.options?.format : field.type;
  // Durations are typed as shown: "1:30" is 5400 seconds.
  if (format === 'duration') {
    return parseDuration(q, field.type === 'formula' ? field.options.durationFormat || 'h:mm' : field.options?.format);
  }
  const n = parseNumber(q);
  if (n === null) return null;
  // Percent filters are typed as shown: "50" and "50%" both mean 0.5.
  return format === 'percent' && typeof q === 'string' && !q.trim().endsWith('%') ? n / 100 : n;
}

function isEmptyValue(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && v.error) return false;
  return isEmpty(v);
}

/** Compile a filter group into a predicate (null when it filters nothing). */
export function compileFilter(base, table, group, now = new Date(base.now())) {
  if (!group?.conditions?.length) return null;
  const tests = [];
  for (const c of group.conditions) {
    if (c.conditions) {
      const t = compileFilter(base, table, c, now);
      if (t) tests.push(t);
    } else if (isActive(c)) {
      const t = conditionTest(base, table, c, now);
      if (t) tests.push(t);
    }
  }
  if (!tests.length) return null;
  if (tests.length === 1) return tests[0];
  return group.conjunction === 'or' ? (rec) => tests.some((t) => t(rec)) : (rec) => tests.every((t) => t(rec));
}

/* -------------------------------------------------------------- sorting */

/**
 * A sort key for a value: numbers for numeric kinds, a choice index for
 * single selects, timestamps for dates, lowercase text otherwise. Empty
 * values give null and sort last in either direction.
 */
export function sortKeyFn(base, table, field) {
  const compute = base.compute;
  const ctx = compute.ctx;
  const kind = valueKind(field, ctx);
  if (field.type === 'singleSelect') {
    const index = new Map((field.options.choices || []).map((c, i) => [c.id, i]));
    return (rec) => {
      const v = compute.value(table, rec, field);
      return v ? index.get(v) ?? 1e9 : null;
    };
  }
  if (kind === 'number') {
    return (rec) => {
      const v = compute.value(table, rec, field);
      return isNum(v) ? v : null;
    };
  }
  if (kind === 'checkbox') return (rec) => (compute.value(table, rec, field) ? 1 : 0);
  if (kind === 'date') {
    return (rec) => {
      const d = toDate(compute.value(table, rec, field));
      return d ? d.getTime() : null;
    };
  }
  // Lookups and unique rollups sort by their first value, as the field it
  // comes from sorts: $200 before $1,000.
  const source = field.type === 'lookup' ? ctx.lookupTarget?.(field)
    : field.type === 'rollup' && field.options?.fn === 'unique' ? compute.rollupTarget?.(table, field) : null;
  const sourceKind = source && valueKind(source, ctx);
  if (sourceKind === 'number' || sourceKind === 'date') {
    return (rec) => {
      const v = compute.value(table, rec, field);
      const first = Array.isArray(v) ? v.flat(Infinity).find((x) => !isEmptyValue(x)) : v;
      if (first === undefined || first === null || first === '') return null;
      if (sourceKind === 'date') return toDate(first)?.getTime() ?? null;
      // Unique rollups list values as text.
      const n = typeof first === 'string' ? Number(first) : first;
      return isNum(n) ? n : null;
    };
  }
  return (rec) => {
    const v = compute.value(table, rec, field);
    if (isEmptyValue(v)) return null;
    const s = toText(field, v, ctx);
    return s === '' ? null : s;
  };
}

function compareKeys(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/** Sort records in place by sort specs [{ fieldId, dir }]. Stable. */
export function sortRecords(base, table, records, sorts) {
  const specs = (sorts || []).map((s) => ({ field: table.field(s.fieldId), desc: s.dir === 'desc' })).filter((s) => s.field);
  if (!specs.length) return records;
  const keyFns = specs.map((s) => sortKeyFn(base, table, s.field));
  const n = records.length;
  const keys = specs.map((_, k) => {
    const arr = new Array(n);
    for (let i = 0; i < n; i++) arr[i] = keyFns[k](records[i]);
    return arr;
  });
  const idx = new Int32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  const sorted = Array.from(idx).sort((i, j) => {
    for (let k = 0; k < specs.length; k++) {
      const a = keys[k][i];
      const b = keys[k][j];
      if (a === b) continue;
      // Empty values stay last in both directions.
      if (a === null) return 1;
      if (b === null) return -1;
      const c = compareKeys(a, b);
      if (c) return specs[k].desc ? -c : c;
    }
    return i - j;
  });
  const copy = records.slice();
  for (let i = 0; i < n; i++) records[i] = copy[sorted[i]];
  return records;
}

/* ------------------------------------------------------------- grouping */

/** Group key and label for a value. Multi-value fields group by combination. */
function groupKeyFn(base, table, field) {
  const compute = base.compute;
  const ctx = compute.ctx;
  // Options in option order, so [X, Y] and [Y, X] are one group.
  const optionIndex = field.type === 'multipleSelect' ? new Map((field.options.choices || []).map((c, i) => [c.id, i])) : null;
  return (rec) => {
    const v = compute.value(table, rec, field);
    if (isEmptyValue(v)) return { key: '', value: null };
    if (field.type === 'singleSelect') return { key: v, value: v };
    if (field.type === 'checkbox') return { key: v ? '1' : '', value: !!v };
    if (field.type === 'multipleSelect') {
      const arr = (Array.isArray(v) ? v : [v]).slice().sort((a, b) => (optionIndex.get(a) ?? 1e9) - (optionIndex.get(b) ?? 1e9));
      return { key: arr.join('|'), value: arr };
    }
    if (field.type === 'link') {
      const arr = Array.isArray(v) ? v : [v];
      return { key: arr.slice().sort().join('|'), value: arr };
    }
    if (field.type === 'date' || field.type === 'createdTime' || field.type === 'lastModifiedTime') {
      const s = toText(field, v, ctx);
      return { key: s, value: v };
    }
    const s = toText(field, v, ctx);
    return { key: s.toLowerCase(), value: v };
  };
}

/**
 * Split sorted records into nested groups. Returns a tree of
 * { key, path, fieldId, value, depth, records, children }.
 */
export function groupRecords(base, table, records, groups) {
  const specs = (groups || []).map((g) => ({ field: table.field(g.fieldId), desc: g.dir === 'desc' })).filter((g) => g.field);
  if (!specs.length) return null;
  const build = (recs, depth, parentPath) => {
    const spec = specs[depth];
    const keyOf = groupKeyFn(base, table, spec.field);
    const sortKey = sortKeyFn(base, table, spec.field);
    const buckets = new Map();
    for (const r of recs) {
      const { key, value } = keyOf(r);
      let b = buckets.get(key);
      if (!b) {
        b = { key, value, records: [], sortKey: sortKey(r) };
        buckets.set(key, b);
      }
      b.records.push(r);
    }
    const list = [...buckets.values()].sort((a, b) => {
      if (a.key === b.key) return 0;
      if (a.sortKey === null && b.sortKey !== null) return -1;
      if (b.sortKey === null && a.sortKey !== null) return 1;
      const c = compareKeys(a.sortKey, b.sortKey);
      return spec.desc ? -c : c;
    });
    return list.map((b) => {
      // Keys are escaped and always joined below the top: groups under a
      // blank group, or with a / in their name, get paths of their own.
      const key = String(b.key).replace(/%/g, '%25').replace(/\//g, '%2F');
      const path = depth ? `${parentPath}/${key}` : key;
      const node = { key: b.key, path, fieldId: spec.field.id, value: b.value, depth, records: b.records, children: null };
      if (depth + 1 < specs.length) node.children = build(b.records, depth + 1, path);
      return node;
    });
  };
  return build(records, 0, '');
}

/* ------------------------------------------------------------------ run */

const memo = new WeakMap();

/**
 * The records a view shows, filtered and sorted, plus its group tree.
 * Memoized per view until the base changes.
 */
export function runView(base, table, view) {
  let m = memo.get(view);
  const stamp = timeStamp(base, table, view);
  if (m && m.version === base.version && m.table === table.version && m.time === stamp) return m.result;
  const predicate = compileFilter(base, table, view.filters);
  let records = table.ordered();
  records = predicate ? records.filter(predicate) : records.slice();
  const sorts = [...(view.groups || []), ...(view.sorts || [])];
  sortRecords(base, table, records, sorts);
  const tree = view.type === 'grid' || view.type === 'list' ? groupRecords(base, table, records, view.groups) : null;
  // With groups, the flat order follows the tree.
  if (tree) {
    const flat = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.children) walk(n.children);
        else for (const r of n.records) flat.push(r);
      }
    };
    walk(tree);
    records = flat;
  }
  const result = { records, tree, total: table.records.size };
  memo.set(view, { version: base.version, table: table.version, time: stamp, result });
  return result;
}

const TIMELY = new Set(['formula', 'lookup', 'rollup']);

/**
 * When a view's result may change without edits. Date conditions like
 * "today" change at local midnight; computed values (NOW(), TODAY()) can
 * change each minute, as their cached values expire.
 */
function timeStamp(base, table, view) {
  const now = new Date(base.now());
  const day = startOfDay(now).getTime();
  const ids = [...(view.sorts || []), ...(view.groups || [])].map((s) => s.fieldId);
  const walk = (g) => {
    for (const c of g?.conditions || []) {
      if (c.conditions) walk(c);
      else ids.push(c.fieldId);
    }
  };
  walk(view.filters);
  return ids.some((id) => TIMELY.has(table.field(id)?.type)) ? `${day}/${Math.floor(now.getTime() / 60000)}` : day;
}

/**
 * Cells in the view whose text contains the query. Returns
 * [{ recordId, fieldId }] in display order.
 */
export function searchView(base, table, view, records, query, limit = 5000) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const fields = visibleFields(table, view);
  const ctx = base.compute.ctx;
  const out = [];
  for (const rec of records) {
    for (const f of fields) {
      const v = base.compute.value(table, rec, f);
      if (isEmptyValue(v)) continue;
      if (toText(f, v, ctx).toLowerCase().includes(q)) {
        out.push({ recordId: rec.id, fieldId: f.id });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}
