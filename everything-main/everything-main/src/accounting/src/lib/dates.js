/**
 * Dates in records are ISO calendar dates ("2026-10-11") with no time and no
 * zone: a bookkeeping date is a day on a calendar, not an instant. The ledger
 * turns them into day numbers (days since 1970-01-01) for fast comparison.
 */

const DAY = 86400000;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Today as an ISO date in the user's local calendar. */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** ISO date -> integer day number (UTC based, so no DST surprises). */
export function dayNum(iso) {
  if (!iso) return 0;
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
}

export function fromDayNum(n) {
  const dt = new Date(n * DAY);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function addDays(iso, days) {
  return fromDayNum(dayNum(iso) + days);
}

/** Add months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso, months, anchorDay) {
  let y = +iso.slice(0, 4);
  let m = +iso.slice(5, 7) - 1 + months;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  const d = Math.min(anchorDay || +iso.slice(8, 10), daysInMonth(y, m + 1));
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

export function addYears(iso, years) {
  return addMonths(iso, years * 12);
}

export function diffDays(a, b) {
  return dayNum(a) - dayNum(b);
}

export function startOfMonth(iso) {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso) {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  return `${iso.slice(0, 7)}-${pad2(daysInMonth(y, m))}`;
}

export function startOfQuarter(iso) {
  const m = +iso.slice(5, 7);
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${iso.slice(0, 4)}-${pad2(q)}-01`;
}

export function endOfQuarter(iso) {
  return endOfMonth(addMonths(startOfQuarter(iso), 2));
}

export function startOfWeek(iso) {
  // Weeks start on Sunday, as on most US business calendars.
  const n = dayNum(iso);
  const dow = (n + 4) % 7; // 1970-01-01 was a Thursday
  return fromDayNum(n - dow);
}

/** First day of the fiscal year containing `iso`, given the start month (1-12). */
export function fiscalYearStart(iso, startMonth = 1) {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${pad2(startMonth)}-01`;
}

export function fiscalYearEnd(iso, startMonth = 1) {
  return addDays(addMonths(fiscalYearStart(iso, startMonth), 12), -1);
}

/**
 * Named report periods, as offered by every accounting package's date
 * dropdown. Returns { from, to } ISO dates; `from` is null for "all dates".
 */
export const PERIODS = [
  ['all', 'All dates'],
  ['today', 'Today'],
  ['thisWeek', 'This week'],
  ['thisWeekToDate', 'This week to date'],
  ['thisMonth', 'This month'],
  ['thisMonthToDate', 'This month to date'],
  ['thisQuarter', 'This quarter'],
  ['thisQuarterToDate', 'This quarter to date'],
  ['thisYear', 'This year'],
  ['thisYearToDate', 'This year to date'],
  ['thisFiscalYear', 'This fiscal year'],
  ['thisFiscalYearToDate', 'This fiscal year to date'],
  ['yesterday', 'Yesterday'],
  ['lastWeek', 'Last week'],
  ['lastMonth', 'Last month'],
  ['lastQuarter', 'Last quarter'],
  ['lastYear', 'Last year'],
  ['lastFiscalYear', 'Last fiscal year'],
  ['last30', 'Last 30 days'],
  ['last90', 'Last 90 days'],
  ['last365', 'Last 365 days'],
  ['custom', 'Custom'],
];

export function periodRange(key, { now = today(), fiscalStartMonth = 1 } = {}) {
  const t = now;
  switch (key) {
    case 'all': return { from: null, to: null };
    case 'today': return { from: t, to: t };
    case 'yesterday': { const y = addDays(t, -1); return { from: y, to: y }; }
    case 'thisWeek': { const s = startOfWeek(t); return { from: s, to: addDays(s, 6) }; }
    case 'thisWeekToDate': return { from: startOfWeek(t), to: t };
    case 'lastWeek': { const s = addDays(startOfWeek(t), -7); return { from: s, to: addDays(s, 6) }; }
    case 'thisMonth': return { from: startOfMonth(t), to: endOfMonth(t) };
    case 'thisMonthToDate': return { from: startOfMonth(t), to: t };
    case 'lastMonth': { const s = addMonths(startOfMonth(t), -1); return { from: s, to: endOfMonth(s) }; }
    case 'thisQuarter': return { from: startOfQuarter(t), to: endOfQuarter(t) };
    case 'thisQuarterToDate': return { from: startOfQuarter(t), to: t };
    case 'lastQuarter': { const s = addMonths(startOfQuarter(t), -3); return { from: s, to: endOfQuarter(s) }; }
    case 'thisYear': return { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31` };
    case 'thisYearToDate': return { from: `${t.slice(0, 4)}-01-01`, to: t };
    case 'lastYear': { const y = +t.slice(0, 4) - 1; return { from: `${y}-01-01`, to: `${y}-12-31` }; }
    case 'thisFiscalYear': return { from: fiscalYearStart(t, fiscalStartMonth), to: fiscalYearEnd(t, fiscalStartMonth) };
    case 'thisFiscalYearToDate': return { from: fiscalYearStart(t, fiscalStartMonth), to: t };
    case 'lastFiscalYear': {
      const s = addYears(fiscalYearStart(t, fiscalStartMonth), -1);
      return { from: s, to: addDays(addYears(s, 1), -1) };
    }
    case 'last30': return { from: addDays(t, -29), to: t };
    case 'last90': return { from: addDays(t, -89), to: t };
    case 'last365': return { from: addDays(t, -364), to: t };
    default: return { from: startOfMonth(t), to: t };
  }
}

export function periodLabel(key) {
  return (PERIODS.find((p) => p[0] === key) || [null, 'Custom'])[1];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

export function monthName(m, short = false) {
  return (short ? MONTHS_SHORT : MONTHS)[m - 1];
}

let dateStyle = 'mdy';
export function setDateStyle(style) {
  if (['mdy', 'dmy', 'ymd'].includes(style)) dateStyle = style;
}
export function getDateStyle() {
  return dateStyle;
}

/** Short display date per the company's preference: 10/11/2026. */
export function formatDate(iso) {
  if (!iso) return '';
  const y = iso.slice(0, 4);
  const m = iso.slice(5, 7);
  const d = iso.slice(8, 10);
  if (dateStyle === 'dmy') return `${d}/${m}/${y}`;
  if (dateStyle === 'ymd') return `${y}-${m}-${d}`;
  return `${m}/${d}/${y}`;
}

/** Long display date: October 11, 2026. */
export function formatDateLong(iso) {
  if (!iso) return '';
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  return dateStyle === 'dmy' ? `${d} ${monthName(m)} ${y}` : `${monthName(m)} ${d}, ${y}`;
}

/** "October 1 to 11, 2026" style range for report headers. */
export function formatRange(from, to) {
  if (!from && !to) return 'All dates';
  if (!from) return `As of ${formatDateLong(to)}`;
  if (!to) return `Since ${formatDateLong(from)}`;
  const [fy, fm, fd] = [+from.slice(0, 4), +from.slice(5, 7), +from.slice(8, 10)];
  const [ty, tm, td] = [+to.slice(0, 4), +to.slice(5, 7), +to.slice(8, 10)];
  if (dateStyle !== 'dmy') {
    if (fy === ty && fm === tm) return `${monthName(fm)} ${fd} to ${td}, ${ty}`;
    if (fy === ty) return `${monthName(fm)} ${fd} to ${monthName(tm)} ${td}, ${ty}`;
  }
  return `${formatDateLong(from)} to ${formatDateLong(to)}`;
}

/**
 * Parse what a person typed into a date field. Accepts ISO, the company's
 * short style with / - or . separators, two-digit years, and a missing year
 * (meaning this year). Returns an ISO date or null.
 */
export function parseDateInput(text, base = today()) {
  if (!text) return null;
  const s = String(text).trim();
  if (isISODate(s)) return s;
  const parts = s.split(/[\/.\-\s]+/).filter(Boolean).map((p) => p.replace(/\D/g, ''));
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !p)) return null;
  let y; let m; let d;
  if (dateStyle === 'ymd' && parts.length === 3 && parts[0].length === 4) {
    [y, m, d] = parts.map(Number);
  } else if (dateStyle === 'dmy') {
    [d, m, y] = parts.map(Number);
  } else {
    [m, d, y] = parts.map(Number);
  }
  if (y === undefined || Number.isNaN(y)) y = +base.slice(0, 4);
  else if (y < 100) y += 2000;
  const iso = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
  return isISODate(iso) ? iso : null;
}

/**
 * Single-key date shortcuts:
 * + and - move a day, T is today, W/K start and end of week, M/H month,
 * Y/R year. Returns the new ISO date, or null when the key is not one.
 */
export function dateShortcut(iso, key, now = today()) {
  const base = iso || now;
  switch (key) {
    case '+': case '=': return addDays(base, 1);
    case '-': case '_': return addDays(base, -1);
    case 't': case 'T': return now;
    case 'w': case 'W': return startOfWeek(base);
    case 'k': case 'K': return addDays(startOfWeek(base), 6);
    case 'm': case 'M': return startOfMonth(base);
    case 'h': case 'H': return endOfMonth(base);
    case 'y': case 'Y': return `${base.slice(0, 4)}-01-01`;
    case 'r': case 'R': return `${base.slice(0, 4)}-12-31`;
    default: return null;
  }
}

/** Month buckets between two dates: [{ key: '2026-01', from, to, label }]. */
export function monthBuckets(from, to) {
  const out = [];
  let cur = startOfMonth(from);
  while (cur <= to && out.length < 240) {
    const end = endOfMonth(cur);
    out.push({
      key: cur.slice(0, 7),
      from: cur < from ? from : cur,
      to: end > to ? to : end,
      label: `${monthName(+cur.slice(5, 7), true)} ${cur.slice(0, 4)}`,
    });
    cur = addMonths(cur, 1, 1);
  }
  return out;
}

export function quarterBuckets(from, to) {
  const out = [];
  let cur = startOfQuarter(from);
  while (cur <= to && out.length < 80) {
    const end = endOfQuarter(cur);
    const q = Math.floor((+cur.slice(5, 7) - 1) / 3) + 1;
    out.push({ key: `${cur.slice(0, 4)}-Q${q}`, from: cur < from ? from : cur, to: end > to ? to : end, label: `Q${q} ${cur.slice(0, 4)}` });
    cur = addMonths(cur, 3, 1);
  }
  return out;
}

export function yearBuckets(from, to, fiscalStartMonth = 1) {
  const out = [];
  let cur = fiscalYearStart(from, fiscalStartMonth);
  while (cur <= to && out.length < 50) {
    const end = addDays(addYears(cur, 1), -1);
    const label = fiscalStartMonth === 1 ? cur.slice(0, 4) : `FY${end.slice(0, 4)}`;
    out.push({ key: cur.slice(0, 4), from: cur < from ? from : cur, to: end > to ? to : end, label });
    cur = addYears(cur, 1);
  }
  return out;
}
