/**
 * Formatting and parsing for numbers, currency, percentages, durations and
 * dates. Formatters are cached because grid painting calls them for every
 * visible cell on every frame.
 */

const numberFormats = new Map();

function numberFormat(minFrac, maxFrac, grouping = true) {
  const key = `${minFrac}:${maxFrac}:${grouping}`;
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac, useGrouping: grouping });
    numberFormats.set(key, f);
  }
  return f;
}

export function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** precision: digits after the point (0 to 8). */
export function formatNumber(v, precision = 0, grouping = true) {
  if (!isNum(v)) return '';
  const p = Math.max(0, Math.min(8, precision | 0));
  const out = numberFormat(p, p, grouping).format(v);
  // Values that round to zero show no minus sign: "0", not "-0".
  return out.startsWith('-') && !/[1-9]/.test(out) ? out.slice(1) : out;
}

export function formatCurrency(v, symbol = '$', precision = 2) {
  if (!isNum(v)) return '';
  const s = formatNumber(Math.abs(v), precision);
  return `${v < 0 && /[1-9]/.test(s) ? '-' : ''}${symbol}${s}`;
}

/** Percent values are stored as fractions: 0.25 shows as 25%. */
export function formatPercent(v, precision = 0) {
  if (!isNum(v)) return '';
  // 0.145 * 100 is 14.499999...: trimmed to 15 digits it shows as 15%, not 14%.
  return `${formatNumber(Number((v * 100).toPrecision(15)), precision)}%`;
}

/** Parse a typed or pasted number: "1,234.5", "$12", "(30)", "4e3", "50%". */
export function parseNumber(text) {
  if (isNum(text)) return text;
  if (typeof text === 'boolean') return text ? 1 : 0;
  if (text === null || text === undefined) return null;
  // The typographic minus counts as a minus sign.
  let s = String(text).trim().replace(/−/g, '-');
  if (!s) return null;
  // Letters touching the digits make a code or a word, not a number: "Q3",
  // "ID-42", "Apt 4B". A currency code before the amount ("CHF5") is fine,
  // and so is a unit after it ("5kg", "12h") with no word before.
  const pre = s.match(/^\D*/)[0];
  if (/\p{L}[-+]?\.?$/u.test(pre) && !/^[-+(]?\p{L}{2,}$/u.test(pre)) return null;
  if (/\d(?![eE][-+]?\d)\p{L}/u.test(s) && !/^[^\p{L}]*\d[\d.,]*\s*\p{L}+\.?$/u.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  let pct = false;
  if (s.endsWith('%')) {
    pct = true;
    s = s.slice(0, -1);
  }
  // Commas only group digits (1,234 or 1,23,456): "1,5" is a decimal comma,
  // which would silently read as 15.
  const compact = s.replace(/\s/g, '');
  const digits = compact.match(/\d[\d,]*/)?.[0] || '';
  if (digits.includes(',') && !/^\d{1,3}(,\d{2,3})*,\d{3}$/.test(digits.replace(/,+$/, ''))) return null;
  // One decimal point, with no grouping after it: "1.234,56" and "1.2.3" are not numbers.
  if (/\..*[.,]/.test((compact.match(/\d[\d,.]*/)?.[0] || '').replace(/,+$/, ''))) return null;
  s = s.replace(/[\s,]/g, '');
  // A minus sign before a currency symbol: "-$5.00", as currencies show.
  if (/^-[^\d.+-]/.test(s)) {
    neg = !neg;
    s = s.slice(1);
  }
  s = s.replace(/^[^\d.+-]+/, '').replace(/[^\deE.+-]+$/, '');
  if (s.startsWith('-')) {
    neg = !neg;
    s = s.slice(1);
  }
  if (!/^[+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (neg) n = -n;
  return pct ? n / 100 : n;
}

export function parsePercent(text) {
  if (isNum(text)) return text;
  const s = String(text ?? '').trim();
  if (!s) return null;
  const n = parseNumber(s.replace('%', ''));
  return n === null ? null : n / 100;
}

/** Duration formats; values are seconds. */
export const DURATION_FORMATS = ['h:mm', 'h:mm:ss', 'h:mm:ss.s', 'h:mm:ss.ss', 'h:mm:ss.sss'];

export function formatDuration(seconds, format = 'h:mm') {
  if (!isNum(seconds)) return '';
  const neg = seconds < 0;
  let s = Math.abs(seconds);
  const decimals = format.includes('.') ? format.split('.')[1].length : 0;
  if (format === 'h:mm') s = Math.round(s / 60) * 60;
  else s = Math.round(s * 10 ** decimals) / 10 ** decimals;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s - h * 3600 - m * 60;
  let out = `${h}:${String(m).padStart(2, '0')}`;
  if (format !== 'h:mm') {
    const whole = Math.floor(sec + 1e-9);
    out += `:${String(whole).padStart(2, '0')}`;
    if (decimals) out += `.${String(Math.round((sec - whole) * 10 ** decimals)).padStart(decimals, '0')}`;
  }
  return (neg && /[1-9]/.test(out) ? '-' : '') + out;
}

/** "1:30" (h:mm), "1:30:15", "90" (minutes in h:mm, seconds otherwise), "1h 20m". */
export function parseDuration(text, format = 'h:mm') {
  if (isNum(text)) return text;
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  let out = null;
  const units = body.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/);
  if (units && (units[1] || units[2] || units[3])) {
    out = (Number(units[1]) || 0) * 3600 + (Number(units[2]) || 0) * 60 + (Number(units[3]) || 0);
  } else if (/^\d+(\.\d+)?(:\d+(\.\d+)?){1,2}$/.test(body)) {
    const parts = body.split(':').map(Number);
    if (parts.length === 3) out = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (format === 'h:mm') out = parts[0] * 3600 + parts[1] * 60;
    else out = parts[0] * 3600 + parts[1] * 60;
  } else if (/^\d+(\.\d+)?$/.test(body)) {
    out = format === 'h:mm' ? Number(body) * 60 : Number(body);
  }
  if (out === null) return null;
  return neg ? -out : out;
}

/* ------------------------------------------------------------------ dates */

export const DATE_FORMATS = {
  local: 'Local',
  friendly: 'Friendly',
  us: 'US',
  european: 'European',
  iso: 'ISO',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Date-only values are 'YYYY-MM-DD'; values with a time are full ISO strings in UTC. */
export function isDateOnly(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** A Date for a stored value. Date-only values become local midnight. */
export function toDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return new Date(v);
  if (isDateOnly(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A stored date as a local Date with the wall time the cell shows: for
 * fields showing times in GMT, the GMT date and time.
 */
export function shownDate(v, gmt = false) {
  const d = toDate(v);
  if (!d || !gmt || isDateOnly(v)) return d;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

export function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parts(d, gmt) {
  return gmt
    ? { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() }
    : { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), h: d.getHours(), min: d.getMinutes() };
}

export function formatDatePart(p, format = 'local') {
  switch (format) {
    case 'friendly':
      return `${MONTHS[p.m]} ${p.d}, ${p.y}`;
    case 'us':
      return `${p.m + 1}/${p.d}/${p.y}`;
    case 'european':
      return `${p.d}/${p.m + 1}/${p.y}`;
    case 'iso':
      return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}`;
    default:
      return `${p.m + 1}/${p.d}/${p.y}`;
  }
}

export function formatTimePart(p, timeFormat = '12h') {
  if (timeFormat === '24h') return `${pad(p.h)}:${pad(p.min)}`;
  const h12 = p.h % 12 || 12;
  return `${h12}:${pad(p.min)}${p.h < 12 ? 'am' : 'pm'}`;
}

/** opts: { dateFormat, includeTime, timeFormat, gmt } */
export function formatDate(v, opts = {}) {
  const d = toDate(v);
  if (!d) return '';
  const dateOnly = isDateOnly(v) || !opts.includeTime;
  const p = parts(d, !isDateOnly(v) && opts.gmt);
  const date = formatDatePart(p, opts.dateFormat);
  if (dateOnly) return date;
  return `${date} ${formatTimePart(p, opts.timeFormat)}${opts.gmt ? ' GMT' : ''}`;
}

export function shortMonth(m) {
  return MONTHS_SHORT[m];
}
export function monthName(m) {
  return MONTHS[m];
}

/** Make a stored value from a Date: date-only, or a UTC ISO string. */
export function fromDate(d, includeTime) {
  if (!d || Number.isNaN(d.getTime())) return null;
  return includeTime ? d.toISOString() : dateKey(d);
}

/**
 * Parse typed text into a stored date value. Accepts ISO dates and times,
 * numeric dates in the field's order (US or European), month names, and
 * today / tomorrow / yesterday. Returns null when nothing sensible matches.
 */
export function parseDate(text, opts = {}) {
  if (text === null || text === undefined) return null;
  if (text instanceof Date) return fromDate(text, opts.includeTime);
  const s = String(text).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const now = opts.now ? new Date(opts.now) : new Date();
  const rel = { today: 0, now: 0, tomorrow: 1, yesterday: -1 }[lower];
  if (rel !== undefined) {
    const d = new Date(now);
    d.setDate(d.getDate() + rel);
    if (!opts.includeTime || lower !== 'now') d.setHours(opts.includeTime ? now.getHours() : 0, opts.includeTime ? now.getMinutes() : 0, 0, 0);
    return fromDate(d, opts.includeTime);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = toDate(s);
    if (!d || dateKey(d) !== s) return null;
    // Times shown in GMT: midnight GMT, the day as typed.
    if (opts.includeTime && opts.gmt) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString();
    return fromDate(d, opts.includeTime);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : fromDate(d, opts.includeTime);
  }
  // Split off a trailing time: "3pm", "3:30 pm", "15:30", "15:30:10".
  let rest = s;
  let hh = null;
  let mm = 0;
  let utc = false;
  const tm = rest.match(/(?:^|\s|T)(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm|a|p)?\s*(gmt|utc|z)?$/i);
  if (tm && (tm[2] !== undefined || tm[4])) {
    hh = Number(tm[1]);
    mm = Number(tm[2] || 0);
    const ap = (tm[4] || '').toLowerCase();
    if (ap.startsWith('p') && hh < 12) hh += 12;
    if (ap.startsWith('a') && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
    utc = !!tm[5];
    rest = rest.slice(0, tm.index).trim();
  }
  let y;
  let m;
  let d;
  const num = rest.match(/^(\d{1,4})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (num) {
    let a = Number(num[1]);
    let b = Number(num[2]);
    if (num[1].length === 4) {
      y = a;
      m = b;
      d = Number(num[3]);
    } else {
      if (opts.dateFormat === 'european') [a, b] = [b, a];
      m = a;
      d = b;
      y = num[3] ? Number(num[3]) : now.getFullYear();
      if (num[3] && num[3].length === 2) y = fullYear(y);
    }
  } else {
    const words = rest.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    let monthIdx = -1;
    const nums = [];
    for (const w of words) {
      const mi = MONTHS.findIndex((name) => name.toLowerCase().startsWith(w.toLowerCase().slice(0, 3)) && w.length >= 3);
      if (mi >= 0 && monthIdx < 0 && /^[a-z]+\.?$/i.test(w)) monthIdx = mi;
      else if (/^\d+(st|nd|rd|th)?$/i.test(w)) nums.push(parseInt(w, 10));
      else if (!/^(on|of|the)$/i.test(w)) return null;
    }
    if (monthIdx < 0 || !nums.length) {
      if (!rest && hh !== null) {
        y = now.getFullYear();
        m = now.getMonth() + 1;
        d = now.getDate();
      } else return null;
    } else {
      m = monthIdx + 1;
      d = nums[0];
      y = nums[1] ?? now.getFullYear();
      if (nums[0] > 31 && nums[1]) [d, y] = [nums[1], nums[0]];
      if (y < 100) y = fullYear(y);
    }
  }
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1 && y <= 9999)) return null;
  const date = new Date(y, m - 1, d, hh ?? 0, mm, 0, 0);
  if (date.getMonth() !== m - 1) return null;
  // Times shown in GMT are typed in GMT (a date alone is midnight GMT), as
  // are times written with GMT, UTC or Z.
  if (opts.includeTime && (opts.gmt || utc)) {
    return new Date(Date.UTC(y, m - 1, d, hh ?? 0, mm)).toISOString();
  }
  return fromDate(date, opts.includeTime);
}

/** A two-digit year as spreadsheets read it: 00 to 29 are 2000s, 30 to 99 1900s. */
function fullYear(y) {
  return y + (y < 30 ? 2000 : 1900);
}

/** Whole days from a to b (local calendar days). */
export function daysBetween(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/**
 * A stored date value n days later, counting days as its cells show them:
 * in GMT for fields showing GMT times, so a clock change can't move it.
 */
export function addValueDays(v, n, gmt = false) {
  const d = toDate(v);
  if (!d || !gmt || isDateOnly(v)) return d && addDays(d, n);
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

export function addMonths(d, n) {
  const out = new Date(d);
  const day = out.getDate();
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  const last = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
  out.setDate(Math.min(day, last));
  return out;
}

/** Relative time for activity and comments: "just now", "5 minutes ago", ... */
export function timeAgo(ts, now = Date.now()) {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return formatDate(new Date(ts).toISOString(), { dateFormat: 'friendly' });
}

/** File sizes: 1.2 MB. */
export function formatBytes(n) {
  if (!isNum(n)) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
