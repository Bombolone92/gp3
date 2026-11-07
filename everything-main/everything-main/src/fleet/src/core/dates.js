/**
 * Calendar dates are plain "YYYY-MM-DD" strings in the business's local
 * time; times of day are "HH:MM". Keeping them as strings avoids timezone
 * drift when records move between devices.
 */

export const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(now = new Date()) {
  return toISODate(now);
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
  const ms = parseISODate(b) - parseISODate(a);
  return Math.round(ms / 86400000);
}

export function weekday(iso) {
  return parseISODate(iso).getDay();
}

/** First day of the week containing iso. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(iso, weekStart = 0) {
  const wd = weekday(iso);
  return addDays(iso, -((wd - weekStart + 7) % 7));
}

export function startOfMonth(iso) {
  return iso.slice(0, 8) + '01';
}

export function endOfMonth(iso) {
  const d = parseISODate(iso);
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
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
  if (!iso) return '';
  return fmt(opts).format(parseISODate(iso.slice(0, 10)));
}

/** "Mon, Oct 12" */
export function formatDayShort(iso) {
  return formatDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "9:30 AM" */
export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h, m));
}

export function formatTimeRange(start, end) {
  if (!start) return 'Anytime';
  return end ? `${formatTime(start)} - ${formatTime(end)}` : formatTime(start);
}

/** Relative description used in lists: "Today", "Tomorrow", "3 days ago". */
export function relativeDay(iso, ref = today()) {
  const n = diffDays(ref, iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return formatDate(iso, { weekday: 'long' });
  if (n < 0 && n > -30) return `${-n} days ago`;
  return formatDate(iso);
}

/** Relative time for timestamps (ISO datetime). */
export function timeAgo(isoDateTime, now = Date.now()) {
  if (!isoDateTime) return '';
  const s = Math.round((now - new Date(isoDateTime).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  // The local calendar day, not the UTC one the timestamp is written in.
  return formatDate(toISODate(new Date(isoDateTime)));
}

export function monthLabel(iso) {
  return formatDate(iso, { month: 'long', year: 'numeric' });
}

export function nowISO() {
  return new Date().toISOString();
}

export const INTERVAL_UNITS = [
  { id: 'days', label: 'days', one: 'day' },
  { id: 'weeks', label: 'weeks', one: 'week' },
  { id: 'months', label: 'months', one: 'month' },
  { id: 'years', label: 'years', one: 'year' },
];

/** Add a { every, unit } interval to a date. */
export function addInterval(iso, interval, times = 1) {
  const n = Math.round(Number(interval?.every) || 0) * times;
  if (!iso || !n) return iso;
  switch (interval.unit) {
    case 'days':
      return addDays(iso, n);
    case 'weeks':
      return addDays(iso, n * 7);
    case 'years':
      return addMonths(iso, n * 12);
    default:
      return addMonths(iso, n);
  }
}

export function formatInterval(interval) {
  const n = Number(interval?.every) || 0;
  if (!n) return '';
  const u = INTERVAL_UNITS.find((x) => x.id === interval.unit) || INTERVAL_UNITS[2];
  return n === 1 ? `Every ${u.one}` : `Every ${n} ${u.label}`;
}

/** Month key "2026-10" -> "Oct 2026" (short) */
export function monthShort(key) {
  return formatDate(`${key}-01`, { month: 'short', year: 'numeric' });
}

/** The last n month keys ending with the month of `iso`, oldest first. */
export function lastMonths(iso, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(startOfMonth(iso), -i).slice(0, 7));
  return out;
}

/** "in 3 days", "2 weeks ago", "today" */
export function relativeDays(iso, ref = today()) {
  if (!iso) return '';
  const n = diffDays(ref, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  const abs = Math.abs(n);
  let text;
  if (abs < 14) text = `${abs} days`;
  else if (abs < 60) text = `${Math.round(abs / 7)} weeks`;
  else if (abs < 730) text = `${Math.round(abs / 30.44)} months`;
  else text = `${Math.round(abs / 365.25)} years`;
  return n > 0 ? `in ${text}` : `${text} ago`;
}
