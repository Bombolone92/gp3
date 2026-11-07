/**
 * Money is stored as integer cents everywhere. Floats only appear at the
 * edges: parsing user input and formatting for display.
 */

const formatters = new Map();

function formatter(currency, locale) {
  const key = `${locale}|${currency}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatters.set(key, f);
  }
  return f;
}

let defaults = { currency: 'USD', locale: undefined };
// Smallest amount the currency has, in cents: 1 for USD, 100 for JPY (no
// minor unit). Amounts are rounded to it so totals match what is shown and
// what can be paid.
let unit = 1;

function minorUnit(currency) {
  try {
    const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    return 10 ** Math.max(0, 2 - digits);
  } catch {
    return 1;
  }
}

export function setMoneyDefaults({ currency, locale } = {}) {
  if (currency) {
    defaults.currency = currency;
    unit = minorUnit(currency);
  }
  if (locale !== undefined) defaults.locale = locale;
}

/** 12345 -> "$123.45" */
export function formatMoney(cents, currency = defaults.currency, locale = defaults.locale) {
  const value = Number.isFinite(cents) ? cents : 0;
  return formatter(currency, locale).format(value / 100);
}

/** Compact form for charts and stat tiles: 1234500 -> "$12.3K". */
export function formatMoneyShort(cents, currency = defaults.currency, locale = defaults.locale) {
  const key = `${locale}|${currency}|short`;
  let f = formatters.get(key);
  if (!f) {
    // The explicit minimum keeps older engines from writing "$50.0" and "$1.0M".
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 });
    formatters.set(key, f);
  }
  return f.format((Number.isFinite(cents) ? cents : 0) / 100);
}

/**
 * Digits of a typed number as "1234.5", whichever decimal mark was used:
 * "1,234.50" and "1.234,50" both work, and a lone comma before one or two
 * digits ("12,50") is a decimal comma. Other separators are grouping.
 */
function normalizeNumber(input) {
  const s = String(input).replace(/[^0-9.,]/g, '');
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  let mark = null;
  if (dot >= 0 && comma >= 0) mark = dot > comma ? '.' : ',';
  else if (comma >= 0) mark = /^[^,]*,\d{1,2}$/.test(s) ? ',' : null;
  else if (dot >= 0) mark = s.indexOf('.') === dot ? '.' : null;
  if (!mark) return s.replace(/[.,]/g, '');
  const i = s.lastIndexOf(mark);
  return `${s.slice(0, i).replace(/[.,]/g, '')}.${s.slice(i + 1).replace(/[.,]/g, '')}`;
}

/** Parse a typed quantity or percentage ("1,5", "1,000", "8.25"). Returns a number or null. */
export function parseDecimal(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  const cleaned = normalizeNumber(input);
  if (!cleaned || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return /^\s*-/.test(input) ? -n : n;
}

/**
 * Parse what a person typed into a price field. Accepts "1,234.50", "$12",
 * "12.5", "-3", and decimal commas ("12,50", "1.234,50"). Returns integer
 * cents, or null when nothing usable was typed.
 */
export function parseMoney(input) {
  // toFixed first: 0.285 * 100 is 28.499999999999996 in floating point.
  if (typeof input === 'number') return Number.isFinite(input) ? roundCents(Number((input * 100).toFixed(6))) : null;
  if (typeof input !== 'string') return null;
  const negative = /^\s*-|\(.*\)/.test(input);
  const cleaned = normalizeNumber(input);
  if (!cleaned || cleaned === '.') return null;
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
  if (!Number.isFinite(cents)) return null;
  const rounded = roundCents(cents);
  return negative ? -rounded : rounded;
}

/** Cents to a plain editable string: 12345 -> "123.45" (123400 -> "1234" in yen). */
export function centsToInput(cents) {
  if (!Number.isFinite(cents)) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  if (unit === 100 && abs % 100 === 0) return `${sign}${abs / 100}`;
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Round half away from zero to whole cents (whole units for currencies without cents). */
export function roundCents(value) {
  return Math.sign(value) * Math.round(Math.abs(value) / unit) * unit || 0;
}
