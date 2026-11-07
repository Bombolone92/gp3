/** Date helpers. Dates are stored as ISO strings (YYYY-MM-DD) in local time. */

const pad2 = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return !!d && toISO(d) === s;
}

/** Parse YYYY-MM-DD as a local date. Returns null on malformed input. */
export function parseISO(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-08" for a date or ISO string. */
export function monthKey(input = new Date()) {
  const d = typeof input === 'string' ? parseISO(input) || new Date() : input;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function monthLabel(key, { short = false } = {}) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: short ? 'short' : 'long', year: 'numeric' });
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

export function startOfMonthISO(key) {
  return `${key}-01`;
}

export function endOfMonthISO(key) {
  const [y, m] = key.split('-').map(Number);
  return toISO(new Date(y, m, 0));
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Whole days from a to b (b - a). Both ISO strings. */
export function daysBetween(a, b) {
  const da = parseISO(a);
  const db = parseISO(b);
  if (!da || !db) return NaN;
  return Math.round((db - da) / 86400000);
}

export function formatDate(iso, opts = {}) {
  const d = parseISO(iso);
  if (!d) return iso || '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', ...opts });
}

/** Today / Yesterday / weekday for the current week / short date otherwise. */
export function friendlyDay(iso, now = new Date()) {
  const diff = daysBetween(iso, todayISO(now));
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = parseISO(iso);
  if (!d) return iso;
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Best-effort parse of a date written any common way into ISO.
 * `dayFirst` disambiguates numeric dates like 03/04/2026.
 */
export function parseLooseDate(input, { dayFirst = false, now = new Date() } = {}) {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : toISO(input);
  const s = String(input || '').trim();
  if (!s) return null;

  // ISO and ISO-like (2026-08-03, 2026/08/03, 2026.08.03, with optional time)
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // Numeric D/M/Y or M/D/Y with 2- or 4-digit year
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s].*)?$/.exec(s);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let day; let month;
    if (a > 12 && b <= 12) { day = a; month = b; } else if (b > 12 && a <= 12) { month = a; day = b; } else if (dayFirst) { day = a; month = b; } else { month = a; day = b; }
    return build(y, month, day);
  }

  // "Aug 3, 2026", "3 Aug 2026", "August 3 2026", "03-Aug-2026", "Aug 3" (assumes current year)
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,})\.?[\s,-]*(\d{4})?$/i.exec(s);
  if (m) {
    const month = monthIndex(m[2]);
    if (month) return build(m[3] ? Number(m[3]) : now.getFullYear(), month, Number(m[1]));
  }
  m = /^([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?[\s,]*(\d{4})?$/i.exec(s);
  if (m) {
    const month = monthIndex(m[1]);
    if (month) return build(m[3] ? Number(m[3]) : now.getFullYear(), month, Number(m[2]));
  }

  // Compact 20260803
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  return null;

  function build(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
    const date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1) return null;
    return toISO(date);
  }
  function monthIndex(name) {
    const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
    return i === -1 ? 0 : i + 1;
  }
}

/** Given many numeric date strings, decide whether they read day-first. */
export function detectDayFirst(samples) {
  let dayFirst = false;
  let monthFirst = false;
  for (const s of samples) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(s || '').trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) dayFirst = true;
    if (b > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return true;
  if (monthFirst && !dayFirst) return false;
  return false;
}
