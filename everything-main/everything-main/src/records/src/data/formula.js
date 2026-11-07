/**
 * Formula language: a small spreadsheet-style expression language.
 *
 *   IF({Status} = "Done", {Price} * 1.2, BLANK())
 *   CONCATENATE({First}, " ", {Last})   or   {First} & " " & {Last}
 *
 * Field references are written {Field name}. Stored formulas use field ids
 * ({fldXXXXXXXXXXXXXX}) so renaming a field never breaks them; toDisplay and
 * fromDisplay convert between the two. Parsed formulas are compiled once into
 * closures, so evaluating a formula for 100k records costs one call each.
 */
import { toDate, fromDate, isDateOnly, formatDate, dateKey, WEEKDAYS, monthName, parseDate } from '../lib/format.js';

export class FormulaError extends Error {
  constructor(message, code = '#ERROR') {
    super(message);
    this.code = code;
  }
}

/** The stack running out (very long chains of linked values), not an error in a formula. */
export function isStackOverflow(err) {
  // No regular expression here: compiling one can itself run out of stack.
  return (err instanceof RangeError && String(err.message).includes('call stack')) || err?.name === 'InternalError';
}

/* ---------------------------------------------------------------- lexer */

const OPS = ['<=', '>=', '!=', '<>', '=', '<', '>', '+', '-', '*', '/', '&', '(', ')', ',', '%'];

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (c === '{') {
      const end = src.indexOf('}', i + 1);
      if (end < 0) throw new FormulaError('A field reference is missing its closing }');
      tokens.push({ t: 'field', v: src.slice(i + 1, end), at: start });
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < n) {
          const e = src[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else s += src[i++];
      }
      if (i >= n) throw new FormulaError('A text value is missing its closing quote');
      i++;
      tokens.push({ t: 'str', v: s, at: start });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
      if (m) {
        tokens.push({ t: 'num', v: Number(m[0]), at: start });
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      tokens.push({ t: 'id', v: m[0], at: start });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ t: 'op', v: op, at: start });
      i += op.length;
      continue;
    }
    throw new FormulaError(`Unexpected character "${c}"`);
  }
  tokens.push({ t: 'end', at: n });
  return tokens;
}

/* --------------------------------------------------------------- parser */

/**
 * Grammar, loosest first:
 *   cmp    := concat (( = | != | <> | < | > | <= | >= ) concat)*
 *   concat := add ( & add )*
 *   add    := mul (( + | - ) mul)*
 *   mul    := unary (( * | / ) unary)*
 *   unary  := - unary | postfix
 *   postfix:= primary %?
 *   primary:= num | str | {field} | TRUE | FALSE | name ( args ) | ( cmp )
 */
export function parse(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const next = () => tokens[p++];
  const isOp = (...ops) => peek().t === 'op' && ops.includes(peek().v);
  const expect = (v) => {
    const tk = next();
    if (tk.t !== 'op' || tk.v !== v) throw new FormulaError(tk.t === 'end' ? `Expected "${v}" before the end` : `Expected "${v}"`);
  };

  function cmp() {
    let left = concat();
    while (isOp('=', '!=', '<>', '<', '>', '<=', '>=')) {
      let op = next().v;
      if (op === '<>') op = '!=';
      left = { k: 'bin', op, a: left, b: concat() };
    }
    return left;
  }
  function concat() {
    let left = add();
    while (isOp('&')) {
      next();
      left = { k: 'bin', op: '&', a: left, b: add() };
    }
    return left;
  }
  function add() {
    let left = mul();
    while (isOp('+', '-')) {
      const op = next().v;
      left = { k: 'bin', op, a: left, b: mul() };
    }
    return left;
  }
  function mul() {
    let left = unary();
    while (isOp('*', '/')) {
      const op = next().v;
      left = { k: 'bin', op, a: left, b: unary() };
    }
    return left;
  }
  function unary() {
    if (isOp('-')) {
      next();
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      next();
      return unary();
    }
    return postfix();
  }
  function postfix() {
    let e = primary();
    while (isOp('%')) {
      next();
      e = { k: 'bin', op: '/', a: e, b: { k: 'num', v: 100 } };
    }
    return e;
  }
  function primary() {
    const tk = next();
    switch (tk.t) {
      case 'num':
        return { k: 'num', v: tk.v };
      case 'str':
        return { k: 'str', v: tk.v };
      case 'field':
        return { k: 'field', v: tk.v };
      case 'id': {
        const name = tk.v.toUpperCase();
        if (isOp('(')) {
          next();
          const args = [];
          if (!isOp(')')) {
            args.push(cmp());
            while (isOp(',')) {
              next();
              args.push(cmp());
            }
          }
          expect(')');
          if (!FUNCTIONS[name]) throw new FormulaError(`Unknown function ${tk.v}`);
          const [min, max] = FUNCTIONS[name].arity;
          if (args.length < min) throw new FormulaError(`${name} needs at least ${min} argument${min === 1 ? '' : 's'}`);
          if (max >= 0 && args.length > max) throw new FormulaError(`${name} takes at most ${max} argument${max === 1 ? '' : 's'}`);
          return { k: 'call', name, args };
        }
        if (name === 'TRUE') return { k: 'bool', v: true };
        if (name === 'FALSE') return { k: 'bool', v: false };
        throw new FormulaError(`Unknown name "${tk.v}". Put field names in braces, like {${tk.v}}`);
      }
      case 'op':
        if (tk.v === '(') {
          const e = cmp();
          expect(')');
          return e;
        }
        throw new FormulaError(`Unexpected "${tk.v}"`);
      default:
        throw new FormulaError('The formula ends too early');
    }
  }

  if (peek().t === 'end') throw new FormulaError('The formula is empty');
  const ast = cmp();
  if (peek().t !== 'end') throw new FormulaError(`Unexpected "${peek().v}"`);
  return ast;
}

/** Field references in a parsed formula. */
export function references(ast, out = new Set()) {
  if (!ast) return out;
  if (ast.k === 'field') out.add(ast.v);
  if (ast.a) references(ast.a, out);
  if (ast.b) references(ast.b, out);
  if (ast.args) for (const a of ast.args) references(a, out);
  return out;
}

/* ------------------------------------------------------- id <-> display */

/** A field reference as written in a formula: {Cost {USD\}} for a field named Cost {USD}. */
export function fieldRef(name) {
  return `{${String(name).replace(/[\\}]/g, '\\$&')}}`;
}

/**
 * Rewrite the {references} outside of string literals with
 * fn(name, inner text), where \} and \\ in a name stand for } and \.
 * Returns null when a reference is missing its closing }.
 */
function mapRefs(s, fn) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === '{') {
      let j = i + 1;
      let name = '';
      while (j < s.length && s[j] !== '}') {
        if (s[j] === '\\' && (s[j + 1] === '}' || s[j + 1] === '\\')) j++;
        name += s[j++];
      }
      if (j >= s.length) return null;
      out += fn(name, s.slice(i + 1, j));
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Replace field ids with names for editing. Unknown ids stay as they are. */
export function toDisplay(src, fields) {
  const byId = new Map(fields.map((f) => [f.id, f.name]));
  const s = String(src || '');
  return mapRefs(s, (ref, inner) => (byId.has(ref) ? fieldRef(byId.get(ref)) : `{${inner}}`)) ?? s;
}

/** Replace field names with ids for storage. Throws on unknown names. */
export function fromDisplay(src, fields) {
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f.id]));
  const ids = new Set(fields.map((f) => f.id));
  const out = mapRefs(String(src || ''), (ref, inner) => {
    // A backslash typed in a name without escaping still finds the field.
    const id = ids.has(ref) ? ref : byName.get(ref.trim().toLowerCase()) ?? byName.get(inner.trim().toLowerCase());
    if (!id) throw new FormulaError(`Unknown field {${ref}}`);
    return `{${id}}`;
  });
  if (out === null) throw new FormulaError('A field reference is missing its closing }');
  return out;
}

/* ------------------------------------------------------------- coercion */

function isBlank(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

export function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isBlank(v)) return 0;
  if (Array.isArray(v)) return v.length === 1 ? toNum(v[0]) : NaN;
  if (v instanceof Date) return v.getTime();
  const s = String(v).replace(/\s/g, '');
  // Commas only group digits, as in parseNumber: "1,5" is not 15.
  const digits = s.match(/\d[\d,]*/)?.[0] || '';
  if (digits.includes(',') && !/^\d{1,3}(,\d{2,3})*,\d{3}$/.test(digits.replace(/,+$/, ''))) return NaN;
  // One decimal point, with no grouping after it: "1.234,56" is not 1.23456.
  if (/\..*[.,]/.test(s.match(/\d[\d,.]*/)?.[0].replace(/,+$/, '') || '')) return NaN;
  // Decimal numbers only: not "0x10" or "Infinity".
  const t = s.replace(/[,$]/g, '');
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

export function toStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(toStr).join(', ');
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return !!v && v !== '0';
}

const MONTH_NAME = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

function date(v) {
  if (isBlank(v)) return null;
  if (Array.isArray(v)) return date(v[0]);
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  // ISO dates and times as stored; other text only when it reads as a date
  // ("Jan 5, 2024", "1/5/2024 3pm"), so "Room 12" is not December 2001.
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = toDate(s);
    if (d) return d;
  }
  // With a year and a month (by name or in numbers), as the browser reads
  // it: "12-Oct-2026", "Mon, 12 Oct 2026 15:00:45 +0200", seconds and all.
  if (/\d{4}/.test(s) && (MONTH_NAME.test(s) || /\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}/.test(s))) {
    const d = toDate(s);
    if (d) return d;
  }
  const parsed = parseDate(s.replace(/^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+/i, ''), { includeTime: true });
  return parsed ? new Date(parsed) : null;
}

function flat(args, out = []) {
  for (const a of args) {
    if (Array.isArray(a)) flat(a, out);
    else out.push(a);
  }
  return out;
}

function nums(args) {
  return flat(args).filter((v) => !isBlank(v)).map(toNum).filter((n) => !Number.isNaN(n));
}

const UNITS = { milliseconds: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 };

const UNIT_ALIASES = new Map(Object.entries({
  milliseconds: ['ms', 'msec', 'msecs', 'millisecond'], seconds: ['s', 'sec', 'secs', 'second'],
  minutes: ['m', 'min', 'mins', 'minute'], hours: ['h', 'hr', 'hrs', 'hour'], days: ['d', 'day'],
  weeks: ['w', 'wk', 'wks', 'week'], months: ['mo', 'mos', 'month'], quarters: ['q', 'quarter'], years: ['y', 'yr', 'yrs', 'year'],
}).flatMap(([unit, names]) => [unit, ...names].map((n) => [n, unit])));

/** The unit for a name ("min", "hours", "M"); unknown names are #VALUE, not days. */
function unitName(u) {
  // "M" is months and "m" minutes, as in moment.js.
  if (u === 'M') return 'months';
  const unit = UNIT_ALIASES.get(String(u || 'days').trim().toLowerCase());
  if (!unit) throw new FormulaError(`Unknown time unit "${u}"`, '#VALUE');
  return unit;
}

/** Output of date functions: date-only stays date-only. */
function outDate(d, likeDateOnly) {
  if (!d || Number.isNaN(d.getTime())) return null;
  return fromDate(d, !likeDateOnly);
}

/** moment.js localized formats, in US English. */
const LOCALIZED = { LTS: 'h:mm:ss A', LT: 'h:mm A', LLLL: 'dddd, MMMM D, YYYY h:mm A', LLL: 'MMMM D, YYYY h:mm A', LL: 'MMMM D, YYYY', L: 'MM/DD/YYYY' };

function ordinal(n) {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

function formatDateTokens(d, fmt) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  fmt = fmt.replace(/\[[^\]]*]|LTS|LT|LLLL|LLL|LL|L/g, (t) => LOCALIZED[t] ?? t);
  const map = {
    Do: ordinal(d.getDate()), Q: Math.floor(d.getMonth() / 3) + 1, m: d.getMinutes(), s: d.getSeconds(), SSS: pad(d.getMilliseconds(), 3),
    YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(-2), MMMM: monthName(d.getMonth()), MMM: monthName(d.getMonth()).slice(0, 3),
    MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate(), dddd: WEEKDAYS[d.getDay()],
    ddd: WEEKDAYS[d.getDay()].slice(0, 3), HH: pad(d.getHours()), H: d.getHours(), hh: pad(d.getHours() % 12 || 12),
    h: d.getHours() % 12 || 12, mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), A: d.getHours() < 12 ? 'AM' : 'PM',
    a: d.getHours() < 12 ? 'am' : 'pm', X: Math.floor(d.getTime() / 1000), x: d.getTime(),
  };
  return fmt.replace(/\[([^\]]*)]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|SSS|ss|s|Q|A|a|X|x/g, (m, lit) => (lit !== undefined ? lit : String(map[m])));
}

function addTo(d, n, unit) {
  const u = unitName(unit);
  const out = new Date(d);
  if (u === 'months' || u === 'quarters' || u === 'years') {
    const months = n * (u === 'months' ? 1 : u === 'quarters' ? 3 : 12);
    const day = out.getDate();
    out.setDate(1);
    out.setMonth(out.getMonth() + months);
    const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(day, last));
    return out;
  }
  const ms = UNITS[u] ?? 86400000;
  if (ms >= 86400000) {
    out.setDate(out.getDate() + Math.round((n * ms) / 86400000));
    return out;
  }
  return new Date(out.getTime() + n * ms);
}

function diff(a, b, unit) {
  const u = unitName(unit);
  if (u === 'months' || u === 'quarters' || u === 'years') {
    // Whole months from the earlier date: a month is complete when that
    // date plus the months (clamped to the end of a shorter month: Jan 31 +
    // 1 month is Feb 29) is reached.
    const [from, to, sign] = a >= b ? [b, a, 1] : [a, b, -1];
    let whole = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (whole > 0 && addTo(from, whole, 'months') > to) whole--;
    const months = sign * whole;
    return u === 'months' ? months : Math.trunc(months / (u === 'quarters' ? 3 : 12));
  }
  const ms = UNITS[u] ?? 86400000;
  // Days and weeks count calendar time: a day with a daylight saving
  // change (23 or 25 hours) is still one day.
  const wall = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  if (ms >= 86400000) return Math.trunc((wall(a) - wall(b)) / ms);
  return Math.trunc((a.getTime() - b.getTime()) / ms);
}

function isWorkday(d, holidays) {
  const wd = d.getDay();
  return wd !== 0 && wd !== 6 && !holidays.has(dateKey(d));
}

function holidaySet(v) {
  const s = new Set();
  for (const part of flat([v]).flatMap((x) => String(x ?? '').split(','))) {
    const d = date(part.trim());
    if (d) s.add(dateKey(d));
  }
  return s;
}

/* ------------------------------------------------------------ functions */

/**
 * Each function: arity [min, max (-1 = any)], kind of result for display
 * ('number' | 'text' | 'date' | 'checkbox' | 'list' | 'same' = first value
 * argument), and fn(args, ctx). Lazy functions get thunks instead of values.
 */
const F = {};
function def(name, arity, kind, fn, lazy = false) {
  F[name] = { arity, kind, fn, lazy };
}

// Logic
def('IF', [2, 3], 'branches', (a) => (truthy(a[0]()) ? a[1]() : a.length > 2 ? a[2]() : null), true);
def('SWITCH', [2, -1], 'branches', (a) => {
  const v = a[0]();
  let i = 1;
  for (; i + 1 < a.length; i += 2) {
    const c = a[i]();
    if (c === v || toStr(c) === toStr(v)) return a[i + 1]();
  }
  return i < a.length ? a[i]() : null;
}, true);
// An empty list is false, as it is on its own in IF().
def('AND', [1, -1], 'checkbox', (a) => a.every(truthy) && flat(a).every(truthy));
def('OR', [1, -1], 'checkbox', (a) => flat(a).some(truthy));
def('XOR', [1, -1], 'checkbox', (a) => flat(a).filter(truthy).length % 2 === 1);
def('NOT', [1, 1], 'checkbox', (a) => !truthy(a[0]));
def('BLANK', [0, 0], 'text', () => null);
def('ERROR', [0, 1], 'text', (a) => {
  throw new FormulaError(a[0] ? toStr(a[0]) : 'Error');
});
/**
 * Errors IFERROR and ISERROR pass on: a reference cycle (or the result
 * would depend on which field in it was computed first) and the stack
 * running out.
 */
function passOn(err) {
  return err?.code === '#CYCLE' || isStackOverflow(err);
}
def('ISERROR', [1, 1], 'checkbox', (a) => {
  try {
    const v = a[0]();
    return typeof v === 'number' && !Number.isFinite(v);
  } catch (err) {
    if (passOn(err)) throw err;
    return true;
  }
}, true);
def('IFERROR', [2, 2], 'branches', (a) => {
  try {
    const v = a[0]();
    if (typeof v === 'number' && !Number.isFinite(v)) return a[1]();
    return v;
  } catch (err) {
    if (passOn(err)) throw err;
    return a[1]();
  }
}, true);
def('ISBLANK', [1, 1], 'checkbox', (a) => isBlank(a[0]));
def('TRUE', [0, 0], 'checkbox', () => true);
def('FALSE', [0, 0], 'checkbox', () => false);

// Numbers
const num1 = (f) => (a) => f(toNum(a[0]), a);
def('ABS', [1, 1], 'number', num1(Math.abs));
// Rounding works on the value to 15 significant digits, as it is written:
// 1.005 is 1.00499999999999989... in binary but rounds to 1.01. Only that
// noise is trimmed: digits a large value really has are kept.
const clean = (x) => {
  if (!Number.isFinite(x) || Number.isInteger(x)) return x;
  const t = Number(x.toPrecision(15));
  return Math.abs(t - x) <= Math.abs(x) * 4 * Number.EPSILON ? t : x;
};
const roundBy = (round) => (a) => {
  const f = 10 ** (a.length > 1 ? toNum(a[1]) : 0);
  const v = clean(toNum(a[0]) * f);
  return clean((Math.sign(v) * round(Math.abs(v))) / f);
};
def('ROUND', [1, 2], 'number', roundBy(Math.round));
def('ROUNDUP', [1, 2], 'number', roundBy(Math.ceil));
def('ROUNDDOWN', [1, 2], 'number', roundBy(Math.floor));
def('CEILING', [1, 2], 'number', (a) => {
  const s = a.length > 1 ? toNum(a[1]) || 1 : 1;
  return clean(Math.ceil(clean(toNum(a[0]) / s)) * s);
});
def('FLOOR', [1, 2], 'number', (a) => {
  const s = a.length > 1 ? toNum(a[1]) || 1 : 1;
  return clean(Math.floor(clean(toNum(a[0]) / s)) * s);
});
def('INT', [1, 1], 'number', num1(Math.floor));
def('MOD', [2, 2], 'number', (a) => {
  const d = toNum(a[1]);
  if (d === 0) throw new FormulaError('Division by zero', '#DIV/0');
  const v = toNum(a[0]) % d;
  return v !== 0 && Math.sign(v) !== Math.sign(d) ? v + d : v;
});
def('POWER', [2, 2], 'number', (a) => toNum(a[0]) ** toNum(a[1]));
def('SQRT', [1, 1], 'number', (a) => {
  const v = toNum(a[0]);
  if (v < 0) throw new FormulaError('Square root of a negative number', '#NUM');
  return Math.sqrt(v);
});
def('EXP', [1, 1], 'number', num1(Math.exp));
def('LOG', [1, 2], 'number', (a) => Math.log(toNum(a[0])) / Math.log(a.length > 1 ? toNum(a[1]) : 10));
def('LN', [1, 1], 'number', num1(Math.log));
def('EVEN', [1, 1], 'number', num1((v) => {
  const r = Math.ceil(Math.abs(v) / 2) * 2;
  return v < 0 ? -r : r;
}));
def('ODD', [1, 1], 'number', num1((v) => {
  let r = Math.ceil(Math.abs(v));
  if (r % 2 === 0) r++;
  return v < 0 ? -r : r;
}));
def('SUM', [1, -1], 'number', (a) => nums(a).reduce((x, y) => x + y, 0));
def('AVERAGE', [1, -1], 'number', (a) => {
  const xs = nums(a);
  return xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0;
});
def('MAX', [1, -1], 'number', (a) => {
  const xs = nums(a);
  // A loop, not Math.max(...xs): spreading 100k values overflows the stack.
  return xs.length ? xs.reduce((m, x) => (x > m ? x : m)) : 0;
});
def('MIN', [1, -1], 'number', (a) => {
  const xs = nums(a);
  return xs.length ? xs.reduce((m, x) => (x < m ? x : m)) : 0;
});
def('COUNT', [1, -1], 'number', (a) => flat(a).filter((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(toNum(v)))).length);
def('COUNTA', [1, -1], 'number', (a) => flat(a).filter((v) => !isBlank(v)).length);
def('COUNTALL', [1, -1], 'number', (a) => flat(a).length);
def('VALUE', [1, 1], 'number', (a) => {
  const n = toNum(a[0]);
  if (Number.isNaN(n)) throw new FormulaError(`Not a number: ${toStr(a[0])}`, '#VALUE');
  return n;
});

// Text
def('CONCATENATE', [1, -1], 'text', (a) => a.map(toStr).join(''));
def('LEN', [1, 1], 'number', (a) => toStr(a[0]).length);
def('LOWER', [1, 1], 'text', (a) => toStr(a[0]).toLowerCase());
def('UPPER', [1, 1], 'text', (a) => toStr(a[0]).toUpperCase());
// Runs of spaces become one; line breaks in long text stay.
def('TRIM', [1, 1], 'text', (a) => toStr(a[0]).trim().replace(/ {2,}/g, ' '));
def('LEFT', [2, 2], 'text', (a) => toStr(a[0]).slice(0, Math.max(0, toNum(a[1]))));
def('RIGHT', [2, 2], 'text', (a) => {
  const s = toStr(a[0]);
  const n = Math.max(0, toNum(a[1]));
  return n ? s.slice(-n) : '';
});
def('MID', [3, 3], 'text', (a) => toStr(a[0]).substr(Math.max(0, toNum(a[1]) - 1), Math.max(0, toNum(a[2]))));
def('FIND', [2, 3], 'number', (a) => toStr(a[1]).indexOf(toStr(a[0]), Math.max(0, (a.length > 2 ? toNum(a[2]) : 1) - 1)) + 1);
def('SEARCH', [2, 3], 'number', (a) => {
  const i = toStr(a[1]).toLowerCase().indexOf(toStr(a[0]).toLowerCase(), Math.max(0, (a.length > 2 ? toNum(a[2]) : 1) - 1));
  return i < 0 ? null : i + 1;
});
def('SUBSTITUTE', [3, 4], 'text', (a) => {
  const s = toStr(a[0]);
  const from = toStr(a[1]);
  const to = toStr(a[2]);
  if (!from) return s;
  if (a.length < 4) return s.split(from).join(to);
  let n = toNum(a[3]);
  // Only the 1st, 2nd... occurrence can be replaced.
  if (!(n >= 1)) return s;
  let idx = -1;
  while (n-- > 0) {
    idx = s.indexOf(from, idx + 1);
    if (idx < 0) return s;
  }
  return s.slice(0, idx) + to + s.slice(idx + from.length);
});
def('REPLACE', [4, 4], 'text', (a) => {
  const s = toStr(a[0]);
  const start = Math.max(0, toNum(a[1]) - 1);
  return s.slice(0, start) + toStr(a[3]) + s.slice(start + Math.max(0, toNum(a[2])));
});
def('REPT', [2, 2], 'text', (a) => toStr(a[0]).repeat(Math.max(0, Math.min(10000, toNum(a[1])))));
def('T', [1, 1], 'text', (a) => (typeof a[0] === 'string' ? a[0] : ''));
def('ENCODE_URL_COMPONENT', [1, 1], 'text', (a) => encodeURIComponent(toStr(a[0])));
function regex(p, flags = '') {
  let src = toStr(p);
  // Leading flags as Airtable (RE2) writes them: (?i) ignores case, (?m)
  // and (?s) are multiline and dot-all.
  const lead = src.match(/^\(\?([ims]+)\)/);
  if (lead) {
    src = src.slice(lead[0].length);
    flags += [...new Set(lead[1])].join('');
  }
  try {
    return new RegExp(src, flags);
  } catch {
    throw new FormulaError('Invalid regular expression', '#VALUE');
  }
}
def('REGEX_MATCH', [2, 2], 'checkbox', (a) => regex(a[1]).test(toStr(a[0])));
def('REGEX_EXTRACT', [2, 2], 'text', (a) => toStr(a[0]).match(regex(a[1]))?.[0] ?? null);
def('REGEX_REPLACE', [3, 3], 'text', (a) => toStr(a[0]).replace(regex(a[1], 'g'), toStr(a[2])));

// Dates
def('TODAY', [0, 0], 'date', (a, ctx) => dateKey(ctx.now()));
def('NOW', [0, 0], 'date', (a, ctx) => ctx.now().toISOString());
def('DATEADD', [3, 3], 'date', (a) => {
  const d = date(a[0]);
  // Adding hours or less to a date gives a date and time.
  const u = unitName(a[2]);
  const timeUnit = (UNITS[u] ?? 86400000) < 86400000;
  return d ? outDate(addTo(d, toNum(a[1]), a[2]), isDateOnly(a[0]) && !timeUnit) : null;
});
def('DATETIME_DIFF', [2, 3], 'number', (a) => {
  const x = date(a[0]);
  const y = date(a[1]);
  return x && y ? diff(x, y, a[2] ?? 'seconds') : null;
});
def('DATETIME_FORMAT', [1, 2], 'text', (a) => {
  const d = date(a[0]);
  return d ? formatDateTokens(d, a.length > 1 ? toStr(a[1]) : 'YYYY-MM-DDTHH:mm:ss') : null;
});
/** Read text by a moment.js style format ("DD/MM/YYYY HH:mm"); null if it does not match. */
function parseByFormat(text, fmt) {
  const parts = [];
  const months = (n) => {
    for (let i = 0; i < 12; i++) if (n.length >= 3 && monthName(i).toLowerCase().startsWith(n.toLowerCase().slice(0, 3))) return i + 1;
    return 0;
  };
  const tokens = {
    YYYY: ['(\\d{4})', (v, o) => (o.y = +v)], YY: ['(\\d{2})', (v, o) => (o.y = 2000 + +v)],
    MMMM: ['([a-z]+)', (v, o) => (o.M = months(v))], MMM: ['([a-z]+)', (v, o) => (o.M = months(v))],
    MM: ['(\\d{1,2})', (v, o) => (o.M = +v)], M: ['(\\d{1,2})', (v, o) => (o.M = +v)],
    Do: ['(\\d{1,2})(?:st|nd|rd|th)', (v, o) => (o.D = +v)], DD: ['(\\d{1,2})', (v, o) => (o.D = +v)], D: ['(\\d{1,2})', (v, o) => (o.D = +v)],
    HH: ['(\\d{1,2})', (v, o) => (o.h = +v)], H: ['(\\d{1,2})', (v, o) => (o.h = +v)],
    hh: ['(\\d{1,2})', (v, o) => (o.h12 = +v)], h: ['(\\d{1,2})', (v, o) => (o.h12 = +v)],
    mm: ['(\\d{1,2})', (v, o) => (o.m = +v)], m: ['(\\d{1,2})', (v, o) => (o.m = +v)],
    ss: ['(\\d{1,2})', (v, o) => (o.s = +v)], s: ['(\\d{1,2})', (v, o) => (o.s = +v)],
    A: ['([ap]m)', (v, o) => (o.pm = /p/i.test(v))], a: ['([ap]m)', (v, o) => (o.pm = /p/i.test(v))],
  };
  const re = toStr(fmt).replace(/\[([^\]]*)]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|HH|H|hh|h|mm|m|ss|s|A|a|([.*+?^${}()|[\]\\/-])/g, (t, lit, special) => {
    if (lit !== undefined) return lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (special !== undefined) return `\\${special}`;
    parts.push(tokens[t][1]);
    return tokens[t][0];
  });
  const m = String(text).trim().match(new RegExp(`^${re}$`, 'i'));
  if (!m) return null;
  const o = { y: new Date().getFullYear(), M: 1, D: 1, h: 0, m: 0, s: 0 };
  parts.forEach((set, i) => set(m[i + 1], o));
  if (o.h12 !== undefined) o.h = (o.h12 % 12) + (o.pm ? 12 : 0);
  const d = new Date(o.y, o.M - 1, o.D, o.h, o.m, o.s);
  return d.getMonth() === o.M - 1 && d.getDate() === o.D ? d : null;
}

def('DATETIME_PARSE', [1, 2], 'date', (a) => {
  // With a format, the text is read by it (DD/MM/YYYY is day first).
  const d = a.length > 1 && !isBlank(a[1]) ? parseByFormat(toStr(a[0]), a[1]) : null;
  if (d) return fromDate(d, true);
  const v = parseDate(toStr(a[0]), { includeTime: true });
  return v || null;
});
def('DATESTR', [1, 1], 'text', (a) => {
  const d = date(a[0]);
  return d ? dateKey(d) : null;
});
def('YEAR', [1, 1], 'number', (a) => date(a[0])?.getFullYear() ?? null);
def('MONTH', [1, 1], 'number', (a) => (date(a[0]) ? date(a[0]).getMonth() + 1 : null));
def('DAY', [1, 1], 'number', (a) => date(a[0])?.getDate() ?? null);
def('HOUR', [1, 1], 'number', (a) => date(a[0])?.getHours() ?? null);
def('MINUTE', [1, 1], 'number', (a) => date(a[0])?.getMinutes() ?? null);
def('SECOND', [1, 1], 'number', (a) => date(a[0])?.getSeconds() ?? null);
def('WEEKDAY', [1, 2], 'number', (a) => {
  const d = date(a[0]);
  if (!d) return null;
  const start = String(a[1] || 'sunday').toLowerCase().startsWith('mon') ? 1 : 0;
  return (d.getDay() - start + 7) % 7;
});
def('WEEKNUM', [1, 2], 'number', (a) => {
  const d = date(a[0]);
  if (!d) return null;
  const start = String(a[1] || 'sunday').toLowerCase().startsWith('mon') ? 1 : 0;
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const offset = (jan1.getDay() - start + 7) % 7;
  // Whole days: an afternoon is still in the week of its day.
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((Math.round((day - jan1) / 86400000) + offset) / 7) + 1;
});
def('WORKDAY', [2, 3], 'date', (a) => {
  const d = date(a[0]);
  if (!d) return null;
  const holidays = holidaySet(a[2]);
  let n = Math.trunc(toNum(a[1]));
  // About a hundred years of workdays, as WORKDAY_DIFF allows.
  if (!Number.isFinite(n) || Math.abs(n) > 26100) throw new FormulaError('Too many workdays', '#NUM');
  const step = n < 0 ? -1 : 1;
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (n !== 0) {
    out.setDate(out.getDate() + step);
    if (isWorkday(out, holidays)) n -= step;
  }
  return dateKey(out);
});
def('WORKDAY_DIFF', [2, 3], 'number', (a) => {
  const x = date(a[0]);
  const y = date(a[1]);
  if (!x || !y) return null;
  const holidays = holidaySet(a[2]);
  const sign = y >= x ? 1 : -1;
  const from = new Date(Math.min(x, y));
  const to = new Date(Math.max(x, y));
  let count = 0;
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  if (Math.round((end - d) / 86400000) > 36600) throw new FormulaError('Date range too large', '#NUM');
  while (d <= end) {
    if (isWorkday(d, holidays)) count++;
    d.setDate(d.getDate() + 1);
  }
  return sign * count;
});
def('IS_BEFORE', [2, 2], 'checkbox', (a) => {
  const x = date(a[0]);
  const y = date(a[1]);
  return !!(x && y && x < y);
});
def('IS_AFTER', [2, 2], 'checkbox', (a) => {
  const x = date(a[0]);
  const y = date(a[1]);
  return !!(x && y && x > y);
});
def('IS_SAME', [2, 3], 'checkbox', (a) => {
  const x = date(a[0]);
  const y = date(a[1]);
  if (!x || !y) return false;
  const u = unitName(a[2] || 'milliseconds');
  const sameYear = x.getFullYear() === y.getFullYear();
  if (u === 'years') return sameYear;
  if (u === 'quarters') return sameYear && Math.floor(x.getMonth() / 3) === Math.floor(y.getMonth() / 3);
  if (u === 'months') return sameYear && x.getMonth() === y.getMonth();
  // Weeks start on Sunday.
  if (u === 'weeks') return dateKey(new Date(x.getFullYear(), x.getMonth(), x.getDate() - x.getDay())) === dateKey(new Date(y.getFullYear(), y.getMonth(), y.getDate() - y.getDay()));
  if (u === 'days') return dateKey(x) === dateKey(y);
  if (u === 'hours') return dateKey(x) === dateKey(y) && x.getHours() === y.getHours();
  if (u === 'minutes') return Math.floor(x / 60000) === Math.floor(y / 60000);
  if (u === 'seconds') return Math.floor(x / 1000) === Math.floor(y / 1000);
  return x.getTime() === y.getTime();
});
def('TONOW', [1, 2], 'number', (a, ctx) => {
  const d = date(a[0]);
  return d ? Math.abs(diff(ctx.now(), d, a[1] || 'days')) : null;
});
def('FROMNOW', [1, 2], 'number', (a, ctx) => {
  const d = date(a[0]);
  return d ? Math.abs(diff(d, ctx.now(), a[1] || 'days')) : null;
});
def('CREATED_TIME', [0, 0], 'date', (a, ctx) => new Date(ctx.record.ct).toISOString());
def('LAST_MODIFIED_TIME', [0, 0], 'date', (a, ctx) => new Date(ctx.record.mt || ctx.record.ct).toISOString());
def('RECORD_ID', [0, 0], 'text', (a, ctx) => ctx.record.id);

// Arrays
def('ARRAYJOIN', [1, 2], 'text', (a) => flat([a[0]]).filter((v) => !isBlank(v)).map(toStr).join(a.length > 1 ? toStr(a[1]) : ', '));
def('ARRAYUNIQUE', [1, 1], 'list', (a) => [...new Set(flat([a[0]]).map((v) => (typeof v === 'object' ? toStr(v) : v)))]);
def('ARRAYCOMPACT', [1, 1], 'list', (a) => flat([a[0]]).filter((v) => !isBlank(v)));
def('ARRAYFLATTEN', [1, 1], 'list', (a) => flat([a[0]]));
def('ARRAYSLICE', [2, 3], 'list', (a) => {
  const arr = flat([a[0]]);
  const start = toNum(a[1]);
  const end = a.length > 2 ? toNum(a[2]) : undefined;
  return arr.slice(start > 0 ? start - 1 : start, end === undefined ? undefined : end > 0 ? end : end);
});

export const FUNCTIONS = F;

/** Help text for the formula editor, grouped by category. */
export const FUNCTION_HELP = {
  Logical: {
    IF: 'IF(condition, value if true, value if false)', SWITCH: 'SWITCH(expression, pattern, result, ..., default)',
    AND: 'AND(a, b, ...)', OR: 'OR(a, b, ...)', XOR: 'XOR(a, b, ...)', NOT: 'NOT(value)', BLANK: 'BLANK()',
    ERROR: 'ERROR(message)', ISERROR: 'ISERROR(expression)', IFERROR: 'IFERROR(expression, fallback)', ISBLANK: 'ISBLANK(value)',
  },
  Numeric: {
    ABS: 'ABS(number)', ROUND: 'ROUND(number, digits)', ROUNDUP: 'ROUNDUP(number, digits)', ROUNDDOWN: 'ROUNDDOWN(number, digits)',
    CEILING: 'CEILING(number, significance)', FLOOR: 'FLOOR(number, significance)', INT: 'INT(number)', MOD: 'MOD(number, divisor)',
    POWER: 'POWER(base, exponent)', SQRT: 'SQRT(number)', EXP: 'EXP(power)', LOG: 'LOG(number, base)', LN: 'LN(number)',
    EVEN: 'EVEN(number)', ODD: 'ODD(number)', SUM: 'SUM(a, b, ...)', AVERAGE: 'AVERAGE(a, b, ...)', MAX: 'MAX(a, b, ...)',
    MIN: 'MIN(a, b, ...)', COUNT: 'COUNT(a, b, ...)', COUNTA: 'COUNTA(a, b, ...)', COUNTALL: 'COUNTALL(a, b, ...)', VALUE: 'VALUE(text)',
  },
  Text: {
    CONCATENATE: 'CONCATENATE(a, b, ...)', LEN: 'LEN(text)', LOWER: 'LOWER(text)', UPPER: 'UPPER(text)', TRIM: 'TRIM(text)',
    LEFT: 'LEFT(text, count)', RIGHT: 'RIGHT(text, count)', MID: 'MID(text, start, count)', FIND: 'FIND(needle, text, start)',
    SEARCH: 'SEARCH(needle, text, start)', SUBSTITUTE: 'SUBSTITUTE(text, old, new, index)', REPLACE: 'REPLACE(text, start, count, new)',
    REPT: 'REPT(text, times)', T: 'T(value)', ENCODE_URL_COMPONENT: 'ENCODE_URL_COMPONENT(text)', REGEX_MATCH: 'REGEX_MATCH(text, pattern)',
    REGEX_EXTRACT: 'REGEX_EXTRACT(text, pattern)', REGEX_REPLACE: 'REGEX_REPLACE(text, pattern, replacement)',
  },
  Date: {
    TODAY: 'TODAY()', NOW: 'NOW()', DATEADD: 'DATEADD(date, count, "days")', DATETIME_DIFF: 'DATETIME_DIFF(date1, date2, "days")',
    DATETIME_FORMAT: 'DATETIME_FORMAT(date, "YYYY-MM-DD")', DATETIME_PARSE: 'DATETIME_PARSE(text)', DATESTR: 'DATESTR(date)',
    YEAR: 'YEAR(date)', MONTH: 'MONTH(date)', DAY: 'DAY(date)', HOUR: 'HOUR(date)', MINUTE: 'MINUTE(date)', SECOND: 'SECOND(date)',
    WEEKDAY: 'WEEKDAY(date, "Monday")', WEEKNUM: 'WEEKNUM(date)', WORKDAY: 'WORKDAY(start, days, holidays)',
    WORKDAY_DIFF: 'WORKDAY_DIFF(start, end, holidays)', IS_BEFORE: 'IS_BEFORE(date1, date2)', IS_AFTER: 'IS_AFTER(date1, date2)',
    IS_SAME: 'IS_SAME(date1, date2, "day")', TONOW: 'TONOW(date, "days")', FROMNOW: 'FROMNOW(date, "days")',
    CREATED_TIME: 'CREATED_TIME()', LAST_MODIFIED_TIME: 'LAST_MODIFIED_TIME()',
  },
  Array: {
    ARRAYJOIN: 'ARRAYJOIN(values, separator)', ARRAYUNIQUE: 'ARRAYUNIQUE(values)', ARRAYCOMPACT: 'ARRAYCOMPACT(values)',
    ARRAYFLATTEN: 'ARRAYFLATTEN(values)', ARRAYSLICE: 'ARRAYSLICE(values, start, end)',
  },
  Record: { RECORD_ID: 'RECORD_ID()' },
};

/* -------------------------------------------------------------- compile */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
// A whole ISO date or time, nothing after it ("2026-10-12 (v1)" is text).
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function equal(a, b) {
  if (Array.isArray(a)) a = toStr(a);
  if (Array.isArray(b)) b = toStr(b);
  if (isBlank(a) && isBlank(b)) return true;
  // Dates are equal at the same moment, as < and > compare them.
  if (typeof a === 'string' && typeof b === 'string' && a !== b && ISO_MOMENT.test(a) && ISO_MOMENT.test(b)) {
    const da = toDate(a);
    const db = toDate(b);
    if (da && db) return da.getTime() === db.getTime();
  }
  if (typeof a === 'number' || typeof b === 'number') {
    if (isBlank(a) || isBlank(b)) return toNum(a) === 0 && toNum(b) === 0 && (a === 0 || b === 0);
    return toNum(a) === toNum(b);
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return truthy(a) === truthy(b);
  return toStr(a) === toStr(b);
}

function compare(a, b) {
  const da = typeof a === 'string' && ISO_DATE.test(a);
  const db = typeof b === 'string' && ISO_DATE.test(b);
  // Date-only values are local midnight, as in every date function.
  if (da && db) return toDate(a) - toDate(b);
  if (typeof a === 'number' || typeof b === 'number' || typeof a === 'boolean') return toNum(a) - toNum(b);
  return toStr(a).localeCompare(toStr(b));
}

function arith(op, a, b) {
  // Date arithmetic: date - date = days apart is not standard here; keep numbers.
  const x = toNum(a);
  const y = toNum(b);
  switch (op) {
    case '+':
      if (typeof a === 'string' && typeof b === 'string' && (Number.isNaN(x) || Number.isNaN(y))) return a + b;
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      if (y === 0) throw new FormulaError('Division by zero', '#DIV/0');
      return x / y;
    default:
      return null;
  }
}

/** Arithmetic that gives no number ("abc" * 2, LOG(0)) is #NUM, not NaN inside text. */
function finite(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new FormulaError('The result is not a finite number', '#NUM');
  return v;
}

/**
 * Compile an AST into fn(ctx). ctx: { get(fieldId) -> value, record, now() }.
 */
export function compile(ast) {
  switch (ast.k) {
    case 'num':
    case 'str':
    case 'bool': {
      const v = ast.v;
      return () => v;
    }
    case 'field': {
      const id = ast.v;
      return (ctx) => ctx.get(id);
    }
    case 'neg': {
      const a = compile(ast.a);
      return (ctx) => finite(-toNum(a(ctx)));
    }
    case 'bin': {
      const a = compile(ast.a);
      const b = compile(ast.b);
      switch (ast.op) {
        case '&':
          return (ctx) => toStr(a(ctx)) + toStr(b(ctx));
        case '=':
          return (ctx) => equal(a(ctx), b(ctx));
        case '!=':
          return (ctx) => !equal(a(ctx), b(ctx));
        case '<':
          return (ctx) => compare(a(ctx), b(ctx)) < 0;
        case '>':
          return (ctx) => compare(a(ctx), b(ctx)) > 0;
        case '<=':
          return (ctx) => compare(a(ctx), b(ctx)) <= 0;
        case '>=':
          return (ctx) => compare(a(ctx), b(ctx)) >= 0;
        default: {
          const op = ast.op;
          return (ctx) => finite(arith(op, a(ctx), b(ctx)));
        }
      }
    }
    case 'call': {
      const f = FUNCTIONS[ast.name];
      const args = ast.args.map(compile);
      if (f.lazy) return (ctx) => f.fn(args.map((g) => () => g(ctx)), ctx);
      if (f.kind === 'number') return (ctx) => finite(f.fn(args.map((g) => g(ctx)), ctx));
      return (ctx) => f.fn(args.map((g) => g(ctx)), ctx);
    }
    default:
      throw new FormulaError('Bad formula');
  }
}

/**
 * The kind of value a formula produces. fieldKind(id) gives the kind of a
 * referenced field.
 */
export function inferKind(ast, fieldKind) {
  switch (ast.k) {
    case 'num':
      return 'number';
    case 'str':
      return 'text';
    case 'bool':
      return 'checkbox';
    case 'field': {
      const k = fieldKind(ast.v);
      return k === 'select' || k === 'multi' || k === 'link' || k === 'attachment' ? (k === 'select' ? 'text' : 'list') : k || 'text';
    }
    case 'neg':
      return 'number';
    case 'bin':
      if (ast.op === '&') return 'text';
      if (['=', '!=', '<', '>', '<=', '>='].includes(ast.op)) return 'checkbox';
      if (ast.op === '+') {
        const a = inferKind(ast.a, fieldKind);
        const b = inferKind(ast.b, fieldKind);
        if (a === 'text' && b === 'text') return 'text';
      }
      return 'number';
    case 'call': {
      const f = FUNCTIONS[ast.name];
      if (f.kind === 'branches') {
        const branches = ast.name === 'IF' ? ast.args.slice(1) : ast.name === 'SWITCH' ? ast.args.filter((_, i) => i > 1 && (i % 2 === 0 || i === ast.args.length - 1)) : ast.args;
        // BLANK() and "" are empty in any kind: IF({x}, {x} * 2, "") is a number.
        const empty = (a) => (a.k === 'call' && a.name === 'BLANK') || (a.k === 'str' && a.v === '');
        const kinds = branches.map((a) => (empty(a) ? null : inferKind(a, fieldKind))).filter(Boolean);
        if (!kinds.length) return 'text';
        return kinds.every((k) => k === kinds[0]) ? kinds[0] : 'text';
      }
      return f.kind;
    }
    default:
      return 'text';
  }
}

/** Parse and compile, collecting errors instead of throwing. */
export function prepare(src) {
  try {
    const ast = parse(src);
    return { ast, run: compile(ast), refs: references(ast), error: null };
  } catch (err) {
    return { ast: null, run: null, refs: new Set(), error: err.message || String(err) };
  }
}

/** Format a date-ish formula output for display. Re-exported for cells. */
export { formatDate };
