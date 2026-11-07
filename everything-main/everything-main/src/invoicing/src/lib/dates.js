/** Date helpers. All dates are local-time 'YYYY-MM-DD' strings. */

const pad2 = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function yearOf(iso) {
  return String(iso).slice(0, 4);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysInMonth(year, month1) {
  return new Date(year, month1, 0).getDate();
}

/**
 * Same day-of-month `n` months later, clamped to the target month's length
 * (Jan 31 + 1 month = Feb 28/29). `anchorDay` restores the intended day
 * after a clamped month, so a bill anchored to the 31st returns to the 31st
 * in March rather than drifting to the 28th forever.
 */
export function addMonthsClamped(iso, n, anchorDay = null) {
  const d = parseISO(iso);
  // Only a real day-of-month may anchor. A restored backup can carry
  // anything in a rule's anchorDay, and a negative one would send
  // setDate() back into the previous month — a fixed point from which
  // the occurrence arithmetic never advances.
  const anchor = Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31
    ? anchorDay : null;
  const day = anchor || d.getDate();
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const target = new Date(y, m, 1);
  target.setDate(Math.min(day, daysInMonth(target.getFullYear(), target.getMonth() + 1)));
  return toISO(target);
}

/**
 * Is this a date as the app stores one: 'YYYY-MM-DD' with a four-digit
 * year, naming a day that exists? A browser's date field is looser — its
 * year takes five or six digits, so one keystroke too many yields
 * "20260-09-05" — while everything here reads the first four characters as
 * the year: the year files, the {YYYY} prefix token, the reports, and the
 * backup validator, which refuses the whole file over a date shaped like
 * that. The forms check every date they take against this (and against
 * MIN_DATE below, from the other side).
 */
export function isISODate(value) {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

/** The range the app's date fields accept; see isISODate. A year under
 *  1000 fails the same way from the other side: a Date in year 999 writes
 *  back as '999-01-01', three digits, and addDays would store that. */
export const MIN_DATE = '1000-01-01';
export const MAX_DATE = '9999-12-31';

/** Signed whole days from a to b (positive when b is later). */
export function daysBetween(aIso, bIso) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((parseISO(bIso) - parseISO(aIso)) / MS);
}

/**
 * Human date, e.g. "Aug 4, 2026".
 *
 * The formatter is built once and kept: constructing an Intl.DateTimeFormat
 * costs far more than formatting with one, and this is called for every row of
 * every list, every line of a statement, and every date on the paper.
 */
let dateFmt = null;
export function fmtDate(iso) {
  if (!iso) return '';
  try {
    if (!dateFmt) {
      dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return dateFmt.format(parseISO(iso));
  } catch {
    return String(iso);
  }
}

/**
 * The same human date in a specific language, for client-facing paper in
 * the client's language. '' keeps fmtDate's behavior (the app's own
 * locale), and an unknown code falls back to it rather than failing.
 */
const localeFmts = new Map();
export function fmtDateLocale(iso, locale = '') {
  if (!iso) return '';
  if (!locale) return fmtDate(iso);
  try {
    let fmt = localeFmts.get(locale);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' });
      localeFmts.set(locale, fmt);
    }
    return fmt.format(parseISO(iso));
  } catch {
    return fmtDate(iso);
  }
}

export const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 months' },
  { value: 'yearly', label: 'Yearly' },
];

export function freqLabel(freq) {
  return (FREQUENCIES.find((f) => f.value === freq) || FREQUENCIES[1]).label;
}

/** The occurrence after `fromIso` for a recurring schedule. */
export function nextOccurrence(fromIso, freq, anchorDay = null) {
  if (freq === 'weekly') return addDays(fromIso, 7);
  if (freq === 'quarterly') return addMonthsClamped(fromIso, 3, anchorDay);
  if (freq === 'yearly') return addMonthsClamped(fromIso, 12, anchorDay);
  return addMonthsClamped(fromIso, 1, anchorDay);
}

/* ---------- End conditions ---------- */

/** How many invoices a schedule has already drafted. */
export function issuedCount(rule) {
  return Math.max(0, Math.floor(Number(rule?.issued) || 0));
}

/**
 * Occurrences a schedule has left, or null when it runs forever.
 * A date-limited rule counts the periods between its next due date and its
 * end date; a count-limited one simply subtracts what it has issued.
 */
export function remainingOccurrences(rule) {
  if (!rule) return null;
  if (rule.endMode === 'count') {
    return Math.max(0, Math.floor(Number(rule.endCount) || 0) - issuedCount(rule));
  }
  if (rule.endMode === 'date') {
    if (!rule.endDate) return null;
    let n = 0;
    let next = rule.nextDue;
    while (next && next <= rule.endDate && n < 500) {
      n++;
      next = nextOccurrence(next, rule.freq, rule.anchorDay);
    }
    return n;
  }
  return null;
}

/**
 * A schedule that can never draft another invoice: it hit its occurrence cap,
 * or its next date is past its end date. Completed is derived, never stored,
 * so extending the end condition brings a schedule straight back to life.
 */
export function ruleCompleted(rule) {
  if (!rule) return false;
  if (rule.endMode === 'count') {
    const cap = Math.floor(Number(rule.endCount) || 0);
    return cap > 0 && issuedCount(rule) >= cap;
  }
  if (rule.endMode === 'date') {
    return !!(rule.endDate && rule.nextDue && rule.nextDue > rule.endDate);
  }
  return false;
}

/**
 * All due dates of a schedule up to and including `today`, plus the advanced
 * nextDue. Capped so a rule paused for years can't flood the account with
 * back-invoices; the cap keeps at most `max` and skips the rest.
 *
 * An end condition is a hard boundary: a date-limited schedule never draws a
 * date past its end date, and a count-limited one never draws more than it
 * has left, so the catch-up path cannot overshoot a fixed-term engagement.
 */
export function dueOccurrences(rule, today, max = 12) {
  const dates = [];
  const endDate = rule.endMode === 'date' ? rule.endDate : null;
  const remaining = rule.endMode === 'count'
    ? (remainingOccurrences(rule) ?? 0)
    : Infinity;
  let next = rule.nextDue;
  while (next && next <= today && dates.length < remaining) {
    if (endDate && next > endDate) break;
    const after = nextOccurrence(next, rule.freq, rule.anchorDay);
    // A rule whose arithmetic cannot move forward would spin this loop —
    // and the boot that runs it — forever, and drafting from it would
    // re-issue the same invoice at every launch. Draft nothing instead.
    if (!(after > next)) return { dates: [], nextDue: rule.nextDue };
    dates.push(next);
    next = after;
  }
  return { dates: dates.slice(-max), nextDue: next };
}
