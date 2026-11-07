/**
 * All task/milestone dates are date-only ISO strings ("2026-08-05"),
 * interpreted in the user's local timezone. Keeping them as strings avoids
 * every UTC-midnight-shift bug a Date round-trip invites.
 */

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO date string → local-midnight Date. */
export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const d = parseISO(iso);
  return !Number.isNaN(d.getTime()) && todayISO(d) === iso;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

/**
 * Add whole months, clamping the day to the target month's length — so
 * "the 31st, monthly" lands on the 30th or the 28th rather than sliding into
 * the next month.
 */
export function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return todayISO(target);
}

/** Whole days from a to b (positive when b is after a). */
export function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

/**
 * Intl formatters, kept rather than rebuilt.
 *
 * `date.toLocaleDateString(undefined, opts)` is specified as constructing an
 * `Intl.DateTimeFormat` and formatting with it — so every call pays for a new
 * one, which measures at roughly 25 times the cost of formatting with one that
 * already exists. That is fine once and expensive per row: a board draws two
 * of these per dated card (the badge, and the label a screen reader reads out),
 * a list one per row, the timeline one per bar. On a project with a couple of
 * thousand tasks it was most of the time a re-render took.
 *
 * Keyed by the options object itself, which is why the shapes below are module
 * constants: the set of formats this app asks for is fixed and small. The
 * locale and time zone a formatter resolves are fixed for the life of a page
 * either way, so keeping one cannot go stale.
 */
const formatters = new WeakMap();

export function dateFormat(options) {
  let fmt = formatters.get(options);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(undefined, options);
    formatters.set(options, fmt);
  }
  return fmt;
}

const SHORT = { month: 'short', day: 'numeric' };
const SHORT_WITH_YEAR = { month: 'short', day: 'numeric', year: 'numeric' };
const LONG = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
const MONTH_WITH_YEAR = { month: 'short', year: 'numeric' };

/** "2026-08-05" → "Aug 5" (or "Aug 5, 2025" when not this year). */
export function fmtShort(iso, now = new Date()) {
  if (!iso) return '';
  const d = parseISO(iso);
  const shape = d.getFullYear() === now.getFullYear() ? SHORT : SHORT_WITH_YEAR;
  return dateFormat(shape).format(d);
}

/** "2026-08-05" → "Tuesday, Aug 5, 2026". */
export function fmtLong(iso) {
  if (!iso) return '';
  return dateFormat(LONG).format(parseISO(iso));
}

export function isWeekend(iso) {
  const day = parseISO(iso).getDay();
  return day === 0 || day === 6;
}

export function monthLabel(iso) {
  return dateFormat(MONTH_WITH_YEAR).format(parseISO(iso));
}

/**
 * Due-date status for badges. Done tasks are never "overdue"; a missing
 * date is null (no badge).
 */
export function dueStatus(dueISO, done, today = todayISO()) {
  if (!dueISO || done) return null;
  const d = diffDays(today, dueISO);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 2) return 'soon';
  return 'later';
}
