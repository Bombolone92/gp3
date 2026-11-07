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
 * "12.5", "-3", and comma decimals as typed with euros or kronor: "12,50",
 * "1.234,50". Returns integer cents, or null when nothing usable was typed.
 */
export function parseMoney(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  const negative = /^[^\d]*-|\(.*\)/.test(input);
  let cleaned = input.replace(/[^0-9.,]/g, '');
  const comma = cleaned.lastIndexOf(',');
  const dot = cleaned.lastIndexOf('.');
  if (comma > dot && (dot >= 0 || (/^\d{1,2}$/.test(cleaned.slice(comma + 1)) && cleaned.indexOf(',') === comma))) {
    // A comma after the last dot, or a lone comma before one or two digits, is the decimal point.
    cleaned = `${cleaned.slice(0, comma).replace(/[.,]/g, '')}.${cleaned.slice(comma + 1)}`;
  } else {
    cleaned = cleaned.replace(/,/g, '');
    // "1.234.567": dots grouping thousands.
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(cleaned)) cleaned = cleaned.replace(/\./g, '');
  }
  if (!cleaned || cleaned === '.') return null;
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Cents to a plain editable string: 12345 -> "123.45". */
export function centsToInput(cents) {
  if (!Number.isFinite(cents)) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Round half away from zero to whole cents. */
export function roundCents(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}
