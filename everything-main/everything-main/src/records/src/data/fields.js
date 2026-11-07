/**
 * Field types. Each type knows how to show a stored value as text, how to
 * read typed or pasted text back into a value, how values compare, and
 * which filters and summaries apply.
 *
 * Stored values by type:
 *   text, longText, email, url, phone, barcode  string
 *   number, currency, percent (fraction), duration (seconds), rating  number
 *   checkbox  boolean
 *   singleSelect  choice id;  multipleSelect  choice id[]
 *   date  'YYYY-MM-DD' or an ISO date-time in UTC (with includeTime)
 *   attachment  [{ id, name, size, type, path, thumb?, width?, height? }]
 *   link  record id[] in the linked table
 *   autonumber  number (assigned on create)
 *   formula, lookup, rollup, count, createdTime, lastModifiedTime,
 *   createdBy, lastModifiedBy, button  computed, never stored
 */
import {
  formatNumber, formatCurrency, formatPercent, formatDuration, parseNumber, parsePercent, parseDuration,
  formatDate, parseDate, isNum, formatBytes, shownDate, dateKey, toDate, isDateOnly,
} from '../lib/format.js';

export const TYPES = {
  text: { label: 'Single line text', icon: 'fText', group: 'basic' },
  longText: { label: 'Long text', icon: 'fLongText', group: 'basic' },
  attachment: { label: 'Attachment', icon: 'fAttachment', group: 'basic' },
  checkbox: { label: 'Checkbox', icon: 'fCheckbox', group: 'basic' },
  multipleSelect: { label: 'Multiple select', icon: 'fMulti', group: 'basic' },
  singleSelect: { label: 'Single select', icon: 'fSingle', group: 'basic' },
  date: { label: 'Date', icon: 'fDate', group: 'basic' },
  phone: { label: 'Phone number', icon: 'fPhone', group: 'basic' },
  email: { label: 'Email', icon: 'fEmail', group: 'basic' },
  url: { label: 'URL', icon: 'fUrl', group: 'basic' },
  number: { label: 'Number', icon: 'fNumber', group: 'basic' },
  currency: { label: 'Currency', icon: 'fCurrency', group: 'basic' },
  percent: { label: 'Percent', icon: 'fPercent', group: 'basic' },
  duration: { label: 'Duration', icon: 'fDuration', group: 'basic' },
  rating: { label: 'Rating', icon: 'fRating', group: 'basic' },
  barcode: { label: 'Barcode', icon: 'fBarcode', group: 'basic' },
  link: { label: 'Link to another record', icon: 'fLink', group: 'relational' },
  lookup: { label: 'Lookup', icon: 'fLookup', group: 'relational', computed: true },
  rollup: { label: 'Rollup', icon: 'fRollup', group: 'relational', computed: true },
  count: { label: 'Count', icon: 'fCount', group: 'relational', computed: true },
  formula: { label: 'Formula', icon: 'fFormula', group: 'computed', computed: true },
  autonumber: { label: 'Autonumber', icon: 'fAutonumber', group: 'computed', readOnly: true },
  createdTime: { label: 'Created time', icon: 'fCreatedTime', group: 'computed', computed: true },
  lastModifiedTime: { label: 'Last modified time', icon: 'fModifiedTime', group: 'computed', computed: true },
  createdBy: { label: 'Created by', icon: 'fCreatedBy', group: 'computed', computed: true },
  lastModifiedBy: { label: 'Last modified by', icon: 'fModifiedBy', group: 'computed', computed: true },
  button: { label: 'Button', icon: 'fButton', group: 'computed', computed: true },
};

/** Order in the "add field" menu. */
export const TYPE_ORDER = [
  'link', 'text', 'longText', 'attachment', 'checkbox', 'multipleSelect', 'singleSelect', 'date', 'phone', 'email', 'url',
  'number', 'currency', 'percent', 'duration', 'rating', 'formula', 'rollup', 'count', 'lookup', 'createdTime',
  'lastModifiedTime', 'createdBy', 'lastModifiedBy', 'autonumber', 'barcode', 'button',
];

/** Types that can be the primary field of a table. */
export const PRIMARY_TYPES = new Set([
  'text', 'longText', 'number', 'currency', 'percent', 'duration', 'date', 'phone', 'email', 'url', 'formula',
  'autonumber', 'barcode', 'createdTime',
]);

export function isComputed(field) {
  return !!TYPES[field?.type]?.computed;
}

export function isReadOnly(field) {
  return isComputed(field) || field?.type === 'autonumber';
}

export const DESCRIPTIONS = {
  text: 'A single line of text.',
  longText: 'Longer text that can span several lines.',
  attachment: 'Files such as images, documents and spreadsheets.',
  checkbox: 'A box that can be checked or unchecked.',
  multipleSelect: 'Choose any number of options from a list.',
  singleSelect: 'Choose one option from a list.',
  date: 'A calendar date, with an optional time.',
  phone: 'A telephone number.',
  email: 'An email address.',
  url: 'A web address.',
  number: 'An integer or a decimal number.',
  currency: 'An amount of money.',
  percent: 'A percentage.',
  duration: 'A length of time in hours, minutes and seconds.',
  rating: 'A rating on a scale, shown as icons.',
  barcode: 'A barcode or product code.',
  link: 'Link to records in another table.',
  lookup: 'Show values from a field of linked records.',
  rollup: 'Summarize values from linked records.',
  count: 'Count the linked records.',
  formula: 'Compute a value from other fields.',
  autonumber: 'A unique number for each record, assigned in order.',
  createdTime: 'The date and time each record was created.',
  lastModifiedTime: 'The date and time each record was last changed.',
  createdBy: 'Who created each record.',
  lastModifiedBy: 'Who last changed each record.',
  button: 'A button that opens a link built from the record.',
};

/** Default options for a new field of a type. */
export function defaultOptions(type) {
  switch (type) {
    case 'number':
      return { precision: 0 };
    case 'currency':
      return { symbol: '$', precision: 2 };
    case 'percent':
      return { precision: 0 };
    case 'duration':
      return { format: 'h:mm' };
    case 'rating':
      return { max: 5, icon: 'star', color: 'yellow' };
    case 'checkbox':
      return { color: 'green' };
    case 'singleSelect':
    case 'multipleSelect':
      return { choices: [] };
    case 'date':
      return { dateFormat: 'local', includeTime: false, timeFormat: '12h', gmt: false };
    case 'createdTime':
    case 'lastModifiedTime':
      return { dateFormat: 'local', includeTime: true, timeFormat: '12h', gmt: false };
    case 'link':
      return { tableId: null, inverseId: null, single: false };
    case 'lookup':
      return { linkFieldId: null, targetFieldId: null };
    case 'rollup':
      return { linkFieldId: null, targetFieldId: null, fn: 'sum', precision: 0 };
    case 'count':
      return { linkFieldId: null };
    case 'formula':
      return { formula: '', format: 'auto', precision: 2 };
    case 'button':
      return { label: 'Open', url: '' };
    default:
      return {};
  }
}

export const ROLLUP_FUNCTIONS = {
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
  count: 'Count values',
  countAll: 'Count all',
  countUnique: 'Count unique',
  concat: 'Join as text',
  unique: 'Unique values',
  and: 'All true',
  or: 'Any true',
  earliest: 'Earliest date',
  latest: 'Latest date',
};

/* ---------------------------------------------------------- empty checks */

export function isEmpty(v) {
  if (v === null || v === undefined || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'number') return Number.isNaN(v);
  return false;
}

/* ----------------------------------------------------- category helpers */

/**
 * The kind of value a field produces, for filtering, sorting and summaries.
 * Computed fields report the kind of their result.
 */
export function valueKind(field, ctx) {
  switch (field.type) {
    case 'text':
    case 'longText':
    case 'email':
    case 'url':
    case 'phone':
    case 'barcode':
    case 'createdBy':
    case 'lastModifiedBy':
    case 'button':
      return 'text';
    case 'number':
    case 'currency':
    case 'percent':
    case 'duration':
    case 'rating':
    case 'autonumber':
    case 'count':
      return 'number';
    case 'checkbox':
      return 'checkbox';
    case 'singleSelect':
      return 'select';
    case 'multipleSelect':
      return 'multi';
    case 'date':
    case 'createdTime':
    case 'lastModifiedTime':
      return 'date';
    case 'attachment':
      return 'attachment';
    case 'link':
      return 'link';
    case 'formula':
      return ctx?.formulaKind?.(field) || 'text';
    case 'rollup': {
      const fn = field.options?.fn;
      if (fn === 'concat') return 'text';
      if (fn === 'unique') return 'list';
      if (fn === 'and' || fn === 'or') return 'checkbox';
      if (fn === 'earliest' || fn === 'latest') return 'date';
      return 'number';
    }
    case 'lookup':
      return 'list';
    default:
      return 'text';
  }
}

/* -------------------------------------------------------------- display */

function choiceName(field, id) {
  const c = field.options?.choices?.find((x) => x.id === id);
  return c ? c.name : '';
}

/**
 * Text for a stored (or computed) value, as shown in cells, exports and
 * search. ctx supplies names of linked records and computed-field metadata.
 */
export function toText(field, v, ctx) {
  if (v === null || v === undefined) return '';
  const o = field.options || {};
  switch (field.type) {
    case 'text':
    case 'longText':
    case 'email':
    case 'url':
    case 'phone':
    case 'barcode':
    case 'createdBy':
    case 'lastModifiedBy':
      return String(v);
    case 'number':
      return formatNumber(v, o.precision ?? 0);
    case 'autonumber':
    case 'count':
      return isNum(v) ? String(v) : '';
    case 'currency':
      return formatCurrency(v, o.symbol ?? '$', o.precision ?? 2);
    case 'percent':
      return formatPercent(v, o.precision ?? 0);
    case 'duration':
      return formatDuration(v, o.format);
    case 'rating':
      return isNum(v) && v > 0 ? String(v) : '';
    case 'checkbox':
      return v ? 'checked' : '';
    case 'singleSelect':
      return choiceName(field, v);
    case 'multipleSelect':
      return Array.isArray(v) ? v.map((id) => choiceName(field, id)).filter(Boolean).join(', ') : '';
    case 'date':
    case 'createdTime':
    case 'lastModifiedTime':
      return formatDate(v, o);
    case 'attachment':
      return Array.isArray(v) ? v.map((a) => a.name).join(', ') : '';
    case 'link':
      return Array.isArray(v) ? v.map((id) => ctx?.recordName?.(o.tableId, id) ?? '').join(', ') : '';
    case 'button':
      return o.label || 'Open';
    case 'formula':
      return formatComputed(v, ctx?.formulaKind?.(field) || 'text', o);
    case 'rollup': {
      const kind = valueKind(field);
      if (typeof v === 'object' && v?.error) return v.error;
      if (kind === 'number') {
        if (!isNum(v)) return '';
        // Totals show like the summarized field ("$1,203.50", "50%", "1:30"); counts are plain.
        const total = ['sum', 'avg', 'min', 'max'].includes(o.fn ?? 'sum');
        return formatRollup(v, total ? ctx?.lookupTarget?.(field) : null, o.precision);
      }
      if (kind === 'checkbox') return v ? 'true' : 'false';
      if (kind === 'date') return v ? formatDate(v, { dateFormat: 'local' }) : '';
      if (Array.isArray(v)) return v.map((x) => formatAny(x)).join(', ');
      return formatAny(v);
    }
    case 'lookup': {
      const target = ctx?.lookupTarget?.(field);
      if (!Array.isArray(v)) return formatAny(v);
      if (!target) return v.map(formatAny).join(', ');
      return v.map((x) => (Array.isArray(x) ? toText(target, x, ctx) : toText(target, x, ctx))).filter((s) => s !== '').join(', ');
    }
    default:
      return formatAny(v);
  }
}

/**
 * Text for a cell that splitList reads back: like toText, but select
 * options and linked record names containing commas or quotes are quoted.
 */
export function listText(field, v, ctx) {
  if (!Array.isArray(v) || (field.type !== 'multipleSelect' && field.type !== 'link')) return toText(field, v, ctx);
  const names = field.type === 'link'
    ? v.map((id) => ctx?.recordName?.(field.options.tableId, id) ?? '')
    : v.map((id) => choiceName(field, id)).filter(Boolean);
  return names.map(quoteItem).join(', ');
}

/**
 * A list item as splitList reads it: quoted, with quotes doubled, only when
 * it would split or starts with a quote ('27" monitor' stays as it is).
 */
function quoteItem(name) {
  return /[,\n]|^\s*"/.test(name) ? `"${name.replace(/"/g, '""')}"` : name;
}

/** Format a formula result by its kind and the field's format options. */
export function formatComputed(v, kind, o = {}) {
  if (v === null || v === undefined) return '';
  if (v instanceof Error || (typeof v === 'object' && v?.error)) return v.error || '#ERROR';
  if (Array.isArray(v)) return v.map((x) => formatComputed(x, typeof x === 'number' ? 'number' : 'text', o)).join(', ');
  if (kind === 'number' && isNum(v)) {
    switch (o.format) {
      case 'integer':
        return formatNumber(v, 0);
      case 'decimal':
        return formatNumber(v, o.precision ?? 2);
      case 'currency':
        return formatCurrency(v, o.symbol ?? '$', o.precision ?? 2);
      case 'percent':
        return formatPercent(v, o.precision ?? 0);
      case 'duration':
        return formatDuration(v, o.durationFormat || 'h:mm');
      default:
        return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
    }
  }
  if (kind === 'date') return formatDate(v, { dateFormat: o.dateFormat || 'local', includeTime: o.includeTime ?? !String(v).match(/^\d{4}-\d{2}-\d{2}$/), timeFormat: o.timeFormat || '12h' });
  if (kind === 'checkbox' || typeof v === 'boolean') return v ? 'true' : 'false';
  return formatAny(v);
}

/** A rollup total in the format of the field it summarizes. */
function formatRollup(v, target, precision) {
  const t = target?.options || {};
  switch (target?.type) {
    case 'currency':
      return formatCurrency(v, t.symbol ?? '$', precision ?? t.precision ?? 2);
    case 'percent':
      return formatPercent(v, precision ?? t.precision ?? 0);
    case 'duration':
      return formatDuration(v, t.format);
    case 'formula':
      if (['currency', 'percent', 'duration'].includes(t.format)) return formatComputed(v, 'number', { ...t, precision: precision ?? t.precision });
  }
  return formatNumber(v, precision ?? 0);
}

function formatAny(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(formatAny).join(', ');
  if (typeof v === 'object') return v.name ?? v.error ?? JSON.stringify(v);
  return String(v);
}

/* -------------------------------------------------------------- parsing */

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'checked', 'x', '1', 'on', 'done', 'v']);

/**
 * Read typed or pasted text into a value for a field. Select fields return
 * { value, newChoices } so unknown option names can be added on paste.
 * ctx.findRecords(tableId, names) resolves link names; ctx.findChoice(name)
 * can stand in for a scan of the options (imports make thousands).
 */
export function parseText(field, text, ctx = {}) {
  const o = field.options || {};
  const s = text === null || text === undefined ? '' : String(text);
  const t = s.trim();
  switch (field.type) {
    case 'text':
    case 'barcode':
      return s.replace(/[\r\n]+/g, ' ');
    case 'longText':
      return s;
    case 'email':
    case 'url':
    case 'phone':
      return t;
    case 'number': {
      const n = parseNumber(t);
      return n === null ? null : roundTo(n, o.precision ?? 0);
    }
    case 'currency': {
      const n = parseNumber(t.replace(o.symbol || '$', ''));
      return n === null ? null : roundTo(n, o.precision ?? 2);
    }
    case 'percent':
      return parsePercent(t);
    case 'duration':
      return parseDuration(t, o.format);
    case 'rating': {
      const n = parseNumber(t);
      if (n === null) {
        const stars = (t.match(/[*★]/g) || []).length;
        return stars ? Math.min(stars, o.max || 5) : null;
      }
      return Math.max(0, Math.min(o.max || 5, Math.round(n))) || null;
    }
    case 'checkbox':
      return TRUE_WORDS.has(t.toLowerCase());
    case 'singleSelect': {
      if (!t) return { value: null, newChoices: [] };
      const found = ctx.findChoice ? ctx.findChoice(t) : findChoice(field, t);
      if (found) return { value: found.id, newChoices: [] };
      const c = ctx.makeChoice ? ctx.makeChoice(t) : null;
      return c ? { value: c.id, newChoices: [c] } : { value: null, newChoices: [] };
    }
    case 'multipleSelect': {
      const names = splitList(t);
      const ids = [];
      const newChoices = [];
      for (const name of names) {
        const found = (ctx.findChoice ? ctx.findChoice(name) : findChoice(field, name)) || newChoices.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (found) {
          if (!ids.includes(found.id)) ids.push(found.id);
        } else if (ctx.makeChoice) {
          const c = ctx.makeChoice(name);
          newChoices.push(c);
          ids.push(c.id);
        }
      }
      return { value: ids.length ? ids : null, newChoices };
    }
    case 'date':
      return parseDate(t, o);
    case 'link': {
      if (!t) return [];
      const names = splitList(t);
      return ctx.findRecords ? ctx.findRecords(o.tableId, names) : [];
    }
    case 'attachment':
      return null;
    default:
      return null;
  }
}

/**
 * Round half away from zero, as numbers are shown and ROUND() does. The
 * scaled value is trimmed to 15 digits first: 1.005 * 100 is 100.49999...
 */
function roundTo(n, p) {
  const f = 10 ** Math.max(0, Math.min(8, p));
  return Math.sign(n) * Math.round(Number((Math.abs(n) * f).toPrecision(15))) / f || 0;
}

export function findChoice(field, name) {
  const lower = String(name).trim().toLowerCase();
  return field.options?.choices?.find((c) => c.name.toLowerCase() === lower) || null;
}

/**
 * Split "a, b, \"c, d\"" into items, honoring quotes. A quote opens only at
 * the start of an item and "" inside it is a quote, so 27" monitor stays whole.
 */
export function splitList(text) {
  const s = String(text);
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch !== '"') cur += ch;
      else if (s[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = false;
    } else if (ch === '"' && !cur.trim()) {
      q = true;
      cur = '';
    } else if (ch === ',' || ch === '\n') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/* ------------------------------------------------------------ summaries */

export const SUMMARIES = {
  none: 'None',
  empty: 'Empty',
  filled: 'Filled',
  unique: 'Unique',
  percentEmpty: 'Percent empty',
  percentFilled: 'Percent filled',
  percentUnique: 'Percent unique',
  sum: 'Sum',
  avg: 'Average',
  median: 'Median',
  min: 'Min',
  max: 'Max',
  range: 'Range',
  stdev: 'Standard deviation',
  checked: 'Checked',
  unchecked: 'Unchecked',
  percentChecked: 'Percent checked',
  percentUnchecked: 'Percent unchecked',
  earliest: 'Earliest date',
  latest: 'Latest date',
  dateRange: 'Date range (days)',
  totalSize: 'Total attachment size',
};

export function summariesFor(kind) {
  const base = ['none', 'empty', 'filled', 'unique', 'percentEmpty', 'percentFilled', 'percentUnique'];
  switch (kind) {
    case 'number':
      return [...base, 'sum', 'avg', 'median', 'min', 'max', 'range', 'stdev'];
    case 'checkbox':
      return ['none', 'checked', 'unchecked', 'percentChecked', 'percentUnchecked'];
    case 'date':
      return [...base, 'earliest', 'latest', 'dateRange'];
    case 'attachment':
      return ['none', 'empty', 'filled', 'percentEmpty', 'percentFilled', 'totalSize'];
    default:
      return base;
  }
}

/**
 * Compute a summary over values. fmt formats a number in the field's style
 * (sum and averages of currency stay currency).
 */
export function summarize(kind, values, fn, fmt = (n) => formatNumber(n, 2)) {
  const n = values.length;
  if (!n && fn !== 'none') return fn === 'sum' ? fmt(0) : '';
  let empty = 0;
  for (const v of values) if (isEmpty(v)) empty++;
  const filled = n - empty;
  const pct = (x) => `${n ? Math.round((x / n) * 1000) / 10 : 0}%`;
  const uniqueCount = () => {
    const set = new Set();
    for (const v of values) if (!isEmpty(v)) set.add(Array.isArray(v) ? JSON.stringify(v) : v);
    return set.size;
  };
  const nums = () => values.filter(isNum);
  switch (fn) {
    case 'empty':
      return String(empty);
    case 'filled':
      return String(filled);
    case 'unique':
      return String(uniqueCount());
    case 'percentEmpty':
      return pct(empty);
    case 'percentFilled':
      return pct(filled);
    case 'percentUnique':
      return pct(uniqueCount());
    case 'sum':
      return fmt(nums().reduce((a, b) => a + b, 0));
    case 'avg': {
      const xs = nums();
      return xs.length ? fmt(xs.reduce((a, b) => a + b, 0) / xs.length) : '';
    }
    case 'median': {
      const xs = nums().sort((a, b) => a - b);
      if (!xs.length) return '';
      const mid = xs.length >> 1;
      return fmt(xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2);
    }
    case 'min': {
      const xs = nums();
      // Loops, not Math.min(...xs): spreading 100k values overflows the stack.
      return xs.length ? fmt(xs.reduce((m, x) => (x < m ? x : m))) : '';
    }
    case 'max': {
      const xs = nums();
      return xs.length ? fmt(xs.reduce((m, x) => (x > m ? x : m))) : '';
    }
    case 'range': {
      const xs = nums();
      return xs.length ? fmt(xs.reduce((m, x) => (x > m ? x : m)) - xs.reduce((m, x) => (x < m ? x : m))) : '';
    }
    case 'stdev': {
      const xs = nums();
      if (xs.length < 2) return '';
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
      return fmt(Math.sqrt(variance));
    }
    case 'checked':
      return String(values.filter(Boolean).length);
    case 'unchecked':
      return String(values.filter((v) => !v).length);
    case 'percentChecked':
      return pct(values.filter(Boolean).length);
    case 'percentUnchecked':
      return pct(values.filter((v) => !v).length);
    case 'earliest':
    case 'latest':
    case 'dateRange': {
      const ds = values.filter((v) => typeof v === 'string' && v).sort();
      if (!ds.length) return '';
      if (fn === 'earliest') return formatDate(ds[0], { dateFormat: 'local' });
      if (fn === 'latest') return formatDate(ds[ds.length - 1], { dateFormat: 'local' });
      const days = Math.round((new Date(ds[ds.length - 1]) - new Date(ds[0])) / 86400000);
      return `${days} day${days === 1 ? '' : 's'}`;
    }
    case 'totalSize': {
      let bytes = 0;
      for (const v of values) if (Array.isArray(v)) for (const a of v) bytes += a.size || 0;
      return formatBytes(bytes);
    }
    default:
      return '';
  }
}

/* ----------------------------------------------------------- conversion */

/**
 * Convert a value when a field changes type. Text is the common ground:
 * the old value is shown as text, then read as the new type.
 */
export function convertValue(fromField, toField, v, ctx) {
  if (v === null || v === undefined) return null;
  const from = fromField.type;
  const to = toField.type;
  if (to === 'date' && typeof v === 'string' && valueKind(fromField, ctx) === 'date') return convertDate(fromField, toField, v);
  if (from === to && to !== 'singleSelect' && to !== 'multipleSelect' && to !== 'link') return v;
  // Numbers keep their magnitude between numeric types.
  const numeric = new Set(['number', 'currency', 'percent', 'duration', 'rating', 'autonumber']);
  // Computed numbers (formulas, rollups, counts) keep their full value, not
  // the rounded text they show. Number fields keep it too: 25% or $19.99
  // stay 0.25 and 19.99 whatever the precision shown.
  if (numeric.has(to) && (numeric.has(from) || isNum(v))) {
    if (to === 'rating') return Math.max(0, Math.min(toField.options?.max || 5, Math.round(v))) || null;
    return v;
  }
  // Any number but zero checks the box, whatever its precision shows.
  if (to === 'checkbox' && isNum(v)) return v !== 0;
  if (from === 'checkbox') {
    // A checked box is 1 ($1, 100%, one star) and an unchecked one 0 as a
    // number; a duration of 1 second means nothing.
    if (to === 'number') return v ? 1 : 0;
    if (numeric.has(to)) return v && to !== 'duration' ? 1 : null;
    return parseText(toField, v ? 'checked' : '', ctx);
  }
  // Names with commas stay whole when read back as a list.
  const toList = to === 'multipleSelect' || to === 'link';
  let text = toList ? listText(fromField, v, ctx) : toText(fromField, v, ctx);
  if (toList && from === 'singleSelect') text = quoteItem(text);
  if (to === 'attachment') return null;
  return parseText(toField, text, ctx);
}

/**
 * A date for another date field, from the stored value rather than the text
 * it shows: "10/12/2026" reads differently in US and European fields, and
 * a time shown in GMT would move. Times keep their moment; a field without
 * times gets the day the source shows.
 */
function convertDate(fromField, toField, v) {
  const o = toField.options || {};
  const shown = shownDate(v, !!fromField.options?.gmt);
  if (!shown) return null;
  if (!o.includeTime) return dateKey(shown);
  if (isDateOnly(v)) return parseDate(v, o);
  return toDate(v).toISOString();
}
