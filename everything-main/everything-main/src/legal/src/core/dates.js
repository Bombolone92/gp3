/**
 * Calendar dates are plain "YYYY-MM-DD" strings in the firm's local time and
 * times of day are "HH:MM". Strings avoid timezone drift when records move
 * between devices, and they sort correctly as text.
 */

export const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s) {
  if (!s || typeof s !== 'string') return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** A real calendar date in "YYYY-MM-DD" form (not "2026-02-30" or "2026-13-01"). */
export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISODate(s);
  return !!d && toISODate(d) === s;
}

export function today(now = new Date()) {
  return toISODate(now);
}

export function nowTime(now = new Date()) {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function addMonths(iso, n) {
  const d = parseISODate(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
}

export function weekday(iso) {
  return parseISODate(iso).getDay();
}

/** First day of the week containing iso. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(iso, weekStart = 0) {
  return addDays(iso, -((weekday(iso) - weekStart + 7) % 7));
}

export function startOfMonth(iso) {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso) {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function startOfYear(iso) {
  return iso.slice(0, 4) + '-01-01';
}

export function endOfYear(iso) {
  return iso.slice(0, 4) + '-12-31';
}

export function daysInRange(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "HH:MM" -> minutes since midnight. */
export function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

const fmtCache = new Map();
function fmt(opts) {
  const key = JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(undefined, opts);
    fmtCache.set(key, f);
  }
  return f;
}

/** "Oct 12, 2026" */
export function formatDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  const d = parseISODate(iso);
  return d ? fmt(opts).format(d) : '';
}

/** "Mon, Oct 12" */
export function formatDayShort(iso) {
  return formatDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "October 2026" */
export function formatMonth(iso) {
  return formatDate(iso, { month: 'long', year: 'numeric' });
}

/** "9:30 AM" */
export function formatTime(t) {
  const m = timeToMinutes(t);
  if (m === null) return '';
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, Math.floor(m / 60), m % 60));
}

/** Relative description of a due date: "Today", "Tomorrow", "3 days overdue". */
export function relativeDue(iso, ref) {
  if (!iso) return '';
  const d = diffDays(ref, iso);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${-d} days overdue`;
  if (d < 7) return `In ${d} days`;
  return formatDate(iso);
}

/** Named date ranges used by list filters. Returns [from, to] or null for "all". */
export function namedRange(name, ref, weekStart = 0) {
  switch (name) {
    case 'today':
      return [ref, ref];
    case 'yesterday':
      return [addDays(ref, -1), addDays(ref, -1)];
    case 'week': {
      const s = startOfWeek(ref, weekStart);
      return [s, addDays(s, 6)];
    }
    case 'last-week': {
      const s = addDays(startOfWeek(ref, weekStart), -7);
      return [s, addDays(s, 6)];
    }
    case 'month':
      return [startOfMonth(ref), endOfMonth(ref)];
    case 'last-month': {
      const s = addMonths(startOfMonth(ref), -1);
      return [s, endOfMonth(s)];
    }
    case 'quarter': {
      const m = Math.floor((Number(ref.slice(5, 7)) - 1) / 3) * 3;
      const s = `${ref.slice(0, 4)}-${pad(m + 1)}-01`;
      return [s, endOfMonth(addMonths(s, 2))];
    }
    case 'year':
      return [startOfYear(ref), endOfYear(ref)];
    case 'last-year': {
      const y = String(Number(ref.slice(0, 4)) - 1);
      return [`${y}-01-01`, `${y}-12-31`];
    }
    default:
      return null;
  }
}

export const RANGE_OPTIONS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'quarter', label: 'This quarter' },
  { value: 'year', label: 'This year' },
  { value: 'last-year', label: 'Last year' },
];
