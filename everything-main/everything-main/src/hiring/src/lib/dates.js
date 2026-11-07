/** Date helpers. Dates are 'YYYY-MM-DD' strings, times are 'HH:MM' (24h). */

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function addDays(isoDate, days) {
  const d = parseISODate(isoDate);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Parses 'YYYY-MM-DD' as a local date (not UTC midnight). */
export function parseISODate(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 'HH:MM' -> minutes since midnight, or null when malformed. */
export function toMinutes(time) {
  // Minutes are bounded by the pattern: summing first would silently
  // carry '9:75' into the hour and validate it as 10:15.
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(String(time ?? ''));
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 24 * 60 ? minutes : null;
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a, b) {
  const ms = parseISODate(b) - parseISODate(a);
  return Math.round(ms / 86400000);
}

/**
 * Calendar days since an ISO timestamp or date, never negative. A raw
 * millisecond floor would assume every local day is 24 hours; on the DST
 * fall-back day two instants on the same date sit ≥24h apart, and the
 * labels built on this ('today', 'days in stage') are calendar claims.
 */
export function daysSince(iso, now = new Date()) {
  const then = iso?.includes('T') ? new Date(iso) : parseISODate(iso);
  if (Number.isNaN(then.getTime())) return 0;
  return Math.max(0, daysBetween(toISODate(then), toISODate(now)));
}

/* Formatters are built once: constructing an Intl.DateTimeFormat resolves
   the locale and is an order of magnitude slower than formatting with one,
   and these run per row on every render (an interview row alone formats
   two times). */
const DATE_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DATE_FMT_Y = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const WEEKDAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** 'Mar 4' within the current year, 'Mar 4, 2025' otherwise. */
export function formatDate(isoDate, now = new Date()) {
  if (!isoDate) return '';
  const d = parseISODate(isoDate);
  // Backups are only structurally validated, so a malformed stored date
  // must render as blank, not throw out of Intl mid-render.
  if (Number.isNaN(d.getTime())) return '';
  return d.getFullYear() === now.getFullYear() ? DATE_FMT.format(d) : DATE_FMT_Y.format(d);
}

/** 'Monday, March 4' — used for date group headers. */
export function formatDateLong(isoDate) {
  if (!isoDate) return '';
  const d = parseISODate(isoDate);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAY_FMT.format(d);
}

/**
 * The local calendar day of an ISO timestamp, in formatDate's style.
 * Slicing the date out of the timestamp instead would show the UTC day,
 * which is tomorrow's date every evening west of UTC.
 */
export function formatTimestamp(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return formatDate(toISODate(d), now);
}

/** '14:30' -> '2:30 PM' in the user's locale. */
export function formatTime(time) {
  const minutes = toMinutes(time);
  if (minutes === null) return String(time ?? '');
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return TIME_FMT.format(d);
}

/**
 * 'Aug 20, 2:30 PM' — a timestamp when the day alone is not enough to
 * tell two of them apart (several snapshots can land on one date).
 */
export function formatDateTime(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(toISODate(d), now)}, ${TIME_FMT.format(d)}`;
}

/** Relative label for list metadata: 'today', 'yesterday', '5d ago', '2y ago'. */
export function relativeDays(iso, now = new Date()) {
  const days = daysSince(iso, now);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  // Months only up to a year: an archive holds candidates for as long as
  // the retention window allows, and "36mo ago" is arithmetic the reader
  // has to do. Counted in whole years past that, so the two scales never
  // disagree at the boundary (day 360 is still 12 months, not 0 years).
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? '1y ago' : `${years}y ago`;
}
