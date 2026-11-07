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

export function setMoneyDefaults({ currency, locale } = {}) {
  if (currency) defaults.currency = currency;
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
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
    formatters.set(key, f);
  }
  return f.format((Number.isFinite(cents) ? cents : 0) / 100);
}

/**
 * Parse what a person typed into a price field. Accepts "1,234.50", "$12",
 * "12.5", "-3", "$-3", and a decimal comma ("12,50", "1.234,56"). Returns
 * integer cents, or null when nothing usable was typed.
 */
export function parseMoney(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  const negative = /^[^\d.,]*-|\(.*\)/.test(input);
  const cleaned = decimalPoint(input.replace(/[^0-9.,]/g, ''));
  if (!cleaned || cleaned === '.') return null;
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * A last comma followed by one or two digits is a decimal comma; any
 * other comma (and any dot before a decimal comma) groups thousands.
 * "1.234,5" -> "1234.5", "1,234" -> "1234".
 */
function decimalPoint(s) {
  const comma = s.lastIndexOf(',');
  if (comma > s.lastIndexOf('.') && /^,\d{1,2}$/.test(s.slice(comma))) return `${s.slice(0, comma).replace(/[.,]/g, '')}.${s.slice(comma + 1)}`;
  return s.replace(/,/g, '');
}

/**
 * Parse what a person typed into a number field, reading commas the way
 * parseMoney does ("12,5" -> 12.5, "1,234" -> 1234). Returns null for
 * empty input and NaN for text that is not a number.
 */
export function parseDecimal(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : NaN;
  const s = decimalPoint(String(input ?? '').replace(/\s/g, ''));
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Cents to a plain editable string: 12345 -> "123.45". */
export function centsToInput(cents) {
  if (!Number.isFinite(cents)) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Round half away from zero to whole cents. Products such as 3 * 3.025 * 100
 * come out as 907.4999999999999, so snap to 12 significant digits first and
 * half cents round the way they read.
 */
export function roundCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const v = Number(n.toPrecision(12));
  return Math.sign(v) * Math.round(Math.abs(v)) || 0;
}
