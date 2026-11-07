/** Compact unique id: time component keeps ids roughly sortable. */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Round to 2 decimals without float drift (money, percentages). */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * A figure with the float noise a division leaves shaved off: 2.1 x 3 is
 * 6.300000000000001 to a double, and a reverse split wrote exactly that
 * into every price and strike, which the edit sheets then prefilled
 * verbatim. Twelve significant digits: more than any price this app
 * carries, and clear of where the noise reaches once it accumulates - at
 * fifteen, a price scaled by twenty split pairs came back as
 * 0.850000000000001 and the sheets prefilled that. A caller reading a
 * stored price back through a division can ask for fewer digits, since the
 * stored figure already lost some to its own.
 */
export function tidy(n, digits = 12) {
  return Number.isFinite(n) ? Number(n.toPrecision(digits)) : n;
}

/**
 * The largest figure a record holds: every sanitizer clamps a count or a
 * price here. parseNum refuses anything past it so that no form saves a
 * figure the store then quietly writes down - 10,000,000,000,000,000 shares
 * typed into the issue sheet came back as 1,000,000,000,000,000 under a
 * "saved" toast. The CSV planner opts out to word its own refusals.
 */
export const NUM_MAX = 1e15;

/**
 * Parse a user-typed number: strips commas/spaces and the currency sign or %
 * the field labels invite ("$5,000,000" into a ($) field, "£850,000" into a
 * (£) one, "10%" into the pool (%) field), returns null when unusable.
 *
 * Any currency symbol, not just the dollar: the labels wear the company's
 * own sign, and a figure typed the way its label shows it was refused for
 * every company that does not report in dollars.
 */
export function parseNum(value, { max = NUM_MAX } = {}) {
  const within = (n) => (Number.isFinite(n) && Math.abs(n) <= max ? n : null);
  if (typeof value === 'number') return within(value);
  const s = String(value ?? '').replace(/[\s%\p{Sc}]/gu, '');
  if (!s) return null;
  /* Plain decimal notation only. Number() also reads hex, binary, octal and
     exponents - "0x10" as 16, "1e3" as a thousand - none of which anyone
     types into a share count on purpose. And a comma only ever groups
     thousands here, so "1.000,5" is not half a share more than one: it is a
     decimal-comma figure this app does not read, and it is refused rather
     than stored as 1. The same goes for "0,5" and "2,50": a comma that does
     not close a group of three is a decimal comma, and reading straight past
     it stored a strike of 0.5 as 5 and a 2.50 as 250. Groups before the last
     may be shorter, so "12,34,567" reads the way it is written. */
  if (!/^[+-]?(\d{1,3}(,\d{1,3})*,\d{3}|\d+)?(\.\d*)?$/.test(s) || !/\d/.test(s)) return null;
  return within(Number(s.replace(/,/g, '')));
}

/**
 * A figure with its last thousands group still open - "18," or "18,0" on the
 * way to "18,000" - or a bare sign or point. parseNum refuses each of them,
 * but none is a mistake yet: a grouped number is typed through two or three
 * such states per group, and flagging them paints the field red on every
 * fourth keystroke. They read as nothing until the group closes. Spaces and
 * the symbols parseNum strips are ignored the same way it ignores them.
 */
export function stillTyping(raw) {
  return /^[+-]?(\d{1,3}(,\d{1,3})*,\d{0,2}|\.?)$/u
    .test(String(raw ?? '').replace(/[\s%\p{Sc}]/gu, ''));
}

/**
 * A liquidation multiple typed the way its field labels it: the "(x)" in
 * "Liquidation preference (x)" is exactly what people type after the number,
 * so "1.5x" reads as 1.5. Same null-on-unusable contract as parseNum.
 */
export function parseMultiple(value) {
  return parseNum(String(value ?? '').replace(/\s*x\s*$/i, ''));
}

/** Today as 'YYYY-MM-DD' in local time. */
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Whole months elapsed from ISO date `from` to `to`, floored at 0.
 * A month "elapses" once the day-of-month is reached (Jan 15 → Feb 15 = 1).
 * When the target month is too short for that day, its last day counts
 * (Jan 31 → Feb 28/29 = 1) - the standard vesting convention.
 */
export function monthsBetween(from, to) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const lastDayOfB = new Date(b.getFullYear(), b.getMonth() + 1, 0).getDate();
  if (b.getDate() < Math.min(a.getDate(), lastDayOfB)) months -= 1;
  return Math.max(0, months);
}

/**
 * Shift an ISO date by whole months, clamping the day to the target month's
 * length (Jan 31 + 1 month = Feb 28/29) - the same convention monthsBetween
 * reads back, so a shifted date lands exactly on its vesting boundary.
 */
export function addMonthsISO(iso, months) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.round(months));
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Shift an ISO date by whole days. */
export function addDaysISO(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Math.round(days));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A due date that lands on a weekend moves to the following Monday - the
 * adjustment the IRS applies to every information-return deadline (General
 * Instructions for Certain Information Returns, "When to file").
 *
 * The rule also names legal holidays in the District of Columbia, and none
 * are modeled: the deadlines this serves are 31 January, 28 February and
 * 31 March, and neither those days nor the one or two days a weekend can
 * push them onto is ever a DC holiday. A deadline on any other day would
 * need the holiday calendar too.
 */
export function nextBusinessDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDay();
  return day === 6 ? addDaysISO(iso, 2) : day === 0 ? addDaysISO(iso, 1) : iso;
}

/** Whole days from ISO date `from` to `to`; negative once `to` is earlier. */
export function daysBetween(from, to) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Fractional calendar years between two ISO dates, in whole days over
 * 365.25: the length of an option's term, and the years a cost is spread
 * over. Whole days, the way daysBetween counts them: measured between local
 * midnights, a fortnight across a clock change was 335 or 337 hours, so a
 * figure read differently by the viewer's time zone and by whether daylight
 * saving fell inside the period. Money accrues on accrualYears instead.
 */
export function yearsBetween(from, to) {
  return Math.max(0, daysBetween(from, to) / 365.25);
}

/**
 * Years for interest to accrue over: actual elapsed days over 365, the day
 * count a note states and the one the app's dividend accrual already uses.
 * A $100,000 note at 8% simple is worth $108,000 a year to the day after it
 * was signed; over 365.25 it read $107,994.52, a few dollars under the
 * lender's own statement on every note.
 */
export function accrualYears(from, to) {
  return Math.max(0, daysBetween(from, to) / 365);
}

/**
 * Neutralize spreadsheet formula injection: a string cell starting with
 * =, +, -, @ (or a stray tab/CR) executes as a formula when the CSV is
 * opened in Excel or Google Sheets, so a stakeholder named
 * "=HYPERLINK(...)" would run on the recipient's machine. A leading
 * apostrophe makes spreadsheets read the cell as text. Non-strings
 * (share counts, prices) pass through untouched.
 */
function formulaSafe(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Whether a string is an email address by the reading a browser gives an
 * `<input type="email">`: the WHATWG "valid e-mail address" grammar, so the
 * CSV import agrees with the stakeholder form about what it will take.
 */
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
export function isEmail(value) {
  return EMAIL_RE.test(String(value ?? ''));
}

/** RFC 4180 CSV: quote when needed, double embedded quotes. */
export function csvEscape(value) {
  const s = String(formulaSafe(value) ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

/**
 * Read a query parameter off a hash route ("#/rounds?scenario=abc") and strip
 * it from the URL, so the value is consumed exactly once.
 *
 * The views these parameters feed re-render on every store change, and a
 * parameter left in the hash would reload the saved scenario over whatever
 * the user had since typed into the form. Stripping it with replaceState
 * fires no hashchange, so nothing re-renders on the way past.
 */
export function takeHashParam(name) {
  const [route, query] = String(location.hash || '').split('?');
  if (!query) return null;
  const params = new URLSearchParams(query);
  const value = params.get(name);
  if (value === null) return null;
  params.delete(name);
  const rest = params.toString();
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}${route}${rest ? `?${rest}` : ''}`);
  } catch {
    /* A URL the browser won't let us rewrite (a sandboxed frame) only means
       the parameter is read again on the next render, which is harmless. */
  }
  return value;
}

/** Trigger a client-side file download. */
export function downloadFile(name, text, type = 'text/plain') {
  // Excel assumes a legacy codepage for CSVs without a byte-order mark and
  // mangles every non-ASCII stakeholder name ("José" → "JosÃ©"). The BOM is
  // the documented way to make it read UTF-8; Sheets and Numbers ignore it.
  const content = type === 'text/csv' ? '\ufeff' + text : text;
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
