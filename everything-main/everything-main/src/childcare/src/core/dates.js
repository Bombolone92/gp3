/**
 * Calendar dates are plain "YYYY-MM-DD" strings in the school's local
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
  return formatDate(isoDateTime.slice(0, 10));
}

export function monthLabel(iso) {
  return formatDate(iso, { month: 'long', year: 'numeric' });
}

export function nowISO() {
  return new Date().toISOString();
}

/** Age from a birthday: "8 mo", "2 yr 3 mo", "5 yr". */
export function ageLabel(birthday, ref = today()) {
  const months = ageInMonths(birthday, ref);
  if (months === null) return '';
  if (months < 1) return `${Math.max(0, diffDays(birthday, ref))} days`;
  if (months < 24) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y < 6 && m ? `${y} yr ${m} mo` : `${y} yr`;
}

export function ageInMonths(birthday, ref = today()) {
  if (!birthday) return null;
  const b = parseISODate(birthday);
  const r = parseISODate(ref);
  let months = (r.getFullYear() - b.getFullYear()) * 12 + (r.getMonth() - b.getMonth());
  // A birthday on the 29th to 31st falls on the last day of shorter months (as in
  // addMonths and nextBirthday), so a Feb 29 child turns 3 on Feb 28.
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  if (r.getDate() < b.getDate() && r.getDate() < lastDay) months--;
  return months < 0 ? null : months;
}

/** The next birthday on or after ref, as "YYYY-MM-DD". */
export function nextBirthday(birthday, ref = today()) {
  if (!birthday) return null;
  const [, m, d] = birthday.split('-').map(Number);
  const year = Number(ref.slice(0, 4));
  for (const y of [year, year + 1]) {
    // Feb 29 birthdays fall on Feb 28 in other years.
    const last = new Date(y, m, 0).getDate();
    const iso = `${y}-${pad(m)}-${pad(Math.min(d, last))}`;
    if (iso >= ref) return iso;
  }
  return null;
}

export const monthOf = (iso) => iso.slice(0, 7);
