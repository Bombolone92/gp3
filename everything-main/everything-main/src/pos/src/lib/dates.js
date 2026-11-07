const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in local time. */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM' for the current (or given) date. */
export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Month key of a 'YYYY-MM-DD' date string. */
export function monthKeyOf(iso) {
  return String(iso).slice(0, 7);
}

/** True for a well-formed 'YYYY-MM' key - it also names the month's file. */
export function isMonthKey(key) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(key));
}

/** ISO date shifted by `days` from today (negative = past). */
export function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return todayISO(d);
}

/** Every month key touched by an inclusive ISO date range, ascending. */
export function monthKeysInRange(fromISO, toISO) {
  const out = [];
  let [y, m] = fromISO.split('-').map(Number);
  const end = monthKeyOf(toISO);
  let key = `${y}-${pad2(m)}`;
  while (key <= end) {
    out.push(key);
    m++;
    if (m > 12) { m = 1; y++; }
    key = `${y}-${pad2(m)}`;
  }
  return out;
}

/** All ISO dates in an inclusive range, ascending (report chart domain). */
export function datesInRange(fromISO, toISO) {
  const out = [];
  const d = new Date(`${fromISO}T12:00:00`);
  const end = new Date(`${toISO}T12:00:00`);
  while (d <= end) {
    out.push(todayISO(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const DAY_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const DAY_SHORT_FMT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DAY_FULL_FMT = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

/** 'Tue, Aug 4' for an ISO date. */
export function formatDay(iso) {
  return DAY_FMT.format(new Date(`${iso}T12:00:00`));
}

/** 'Aug 4' for an ISO date - axis labels that must name their month. */
export function formatDayShort(iso) {
  return DAY_SHORT_FMT.format(new Date(`${iso}T12:00:00`));
}

/** 'Tuesday, August 4, 2026' for an ISO date. */
export function formatDayFull(iso) {
  return DAY_FULL_FMT.format(new Date(`${iso}T12:00:00`));
}

/** '2:30 PM' for a timestamp. */
export function formatTime(at) {
  return TIME_FMT.format(new Date(at));
}

/**
 * '5 min ago' / '2 h ago' - coarse age, so a stale held sale is obvious at a
 * glance without anyone doing clock arithmetic.
 */
export function formatAgo(at, now = Date.now()) {
  const sec = Math.max(0, Math.round((now - at) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** 'August 2026' for a 'YYYY-MM' key. */
export function formatMonth(key) {
  return MONTH_FMT.format(new Date(`${key}-15T12:00:00`));
}
