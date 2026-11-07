/**
 * Date and time utilities.
 *
 * Dates are represented as local ISO strings ('YYYY-MM-DD') and times of day
 * as 'HH:MM' 24-hour strings. Shifts are same-day: start must be before end.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTime(hhmm) {
  return typeof hhmm === 'string' && TIME_RE.test(hhmm);
}

export function isValidDate(iso) {
  if (typeof iso !== 'string' || !DATE_RE.test(iso)) return false;
  const d = parseISO(iso);
  return isoDate(d) === iso;
}

/** '09:30' -> 570 (minutes since midnight). Returns null for invalid input. */
export function toMinutes(hhmm) {
  if (!isValidTime(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 570 -> '09:30' */
export function toHHMM(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Duration in minutes for a time range. A range whose end is earlier than
 * its start wraps past midnight into the next day (an overnight shift).
 * Returns null for invalid times or a zero-length range.
 */
export function durationMinutes(start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || e === s) return null;
  return e > s ? e - s : e + 1440 - s;
}

/** True when a valid range wraps past midnight (ends the following day). */
export function isOvernight(start, end) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  return s !== null && e !== null && e < s;
}

/** True when two same-day minute ranges overlap. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Local date -> 'YYYY-MM-DD'. */
export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' -> local Date at midnight. */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** 0 (Sunday) … 6 (Saturday) for a 'YYYY-MM-DD' string. */
export function dayOfWeek(iso) {
  return parseISO(iso).getDay();
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso) {
  const dow = dayOfWeek(iso);
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, diff);
}

/** Seven ISO dates starting at `weekStartISO`. */
export function weekDates(weekStartISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartISO, i));
}

/** First day of the month containing `iso`. */
export function startOfMonth(iso) {
  return `${iso.slice(0, 8)}01`;
}

/** How many days the month containing `iso` holds: 28 to 31. */
export function daysInMonth(iso) {
  const d = parseISO(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** First day of the month `n` months away from the one containing `iso`. */
export function addMonths(iso, n) {
  const d = parseISO(iso);
  return isoDate(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** '2026-08-04' -> 'August 2026' */
export function formatMonth(iso) {
  const d = parseISO(iso);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

export function isoToday(now = new Date()) {
  return isoDate(now);
}

/** '09:30' -> '9:30 AM' */
export function formatTime(hhmm) {
  const mins = toMinutes(hhmm);
  if (mins === null) return hhmm;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Formats a time range; overnight ranges are marked with "+1" (next day). */
export function formatTimeRange(start, end) {
  return `${formatTime(start)} – ${formatTime(end)}${isOvernight(start, end) ? ' +1' : ''}`;
}

/** '2026-08-04' -> 'Tue, Aug 4' */
export function formatDate(iso) {
  const d = parseISO(iso);
  return `${DAY_SHORT[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** '2026-08-04' -> 'August 4, 2026' style short: 'Aug 4, 2026' */
export function formatDateLong(iso) {
  const d = parseISO(iso);
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** 'Today' / 'Tomorrow' / 'Yesterday' / 'Tue, Aug 4' */
export function relativeDayLabel(iso, todayISO) {
  const today = todayISO ?? isoToday();
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  return formatDate(iso);
}

export function dayName(dayIndex) {
  return DAY_NAMES[dayIndex];
}

export function dayShort(dayIndex) {
  return DAY_SHORT[dayIndex];
}

export function monthShort(monthIndex) {
  return MONTH_SHORT[monthIndex];
}

/** Wall-clock time of day right now, as 'HH:MM'. */
export function nowTime(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * 80 -> '1h 20m', 45 -> '45m', 0 -> 'just now'. For time that is still
 * running, where formatHours' '1.3h' reads like an accounting total
 * rather than how long somebody has been on shift.
 */
export function formatElapsed(minutes) {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return 'just now';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** 90 -> '1.5h', 480 -> '8h' */
export function formatHours(minutes) {
  const h = minutes / 60;
  const rounded = Math.round(h * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded}h`;
}
