/**
 * Money is stored as integer cents everywhere. Floats only appear at the
 * edges: parsing user input and formatting for display.
 */

const formatters = new Map();

/** Whether Intl knows the currency code (a bad one would throw on every amount). */
export function isCurrency(code) {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return typeof code === 'string' && code.length === 3;
  } catch {
    return false;
  }
}

function formatter(currency, locale, opts = {}) {
  const key = `${locale}|${currency}|${opts.notation || ''}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency: isCurrency(currency) ? currency : 'USD', ...opts });
    formatters.set(key, f);
  }
  return f;
}

let defaults = { currency: 'USD', locale: undefined };

export function setMoneyDefaults({ currency, locale } = {}) {
  if (currency && isCurrency(currency)) defaults.currency = currency;
  if (locale !== undefined) defaults.locale = locale;
}

/** 12345 -> "$123.45" */
export function formatMoney(cents, currency = defaults.currency, locale = defaults.locale) {
  const value = Number.isFinite(cents) ? cents : 0;
  return formatter(currency, locale).format(value / 100);
}

/** Compact form for charts and stat tiles: 1234500 -> "$12.3K". */
export function formatMoneyShort(cents, currency = defaults.currency, locale = defaults.locale) {
  return formatter(currency, locale, { notation: 'compact', maximumFractionDigits: 1 }).format((Number.isFinite(cents) ? cents : 0) / 100);
}

/**
 * Parse what a person typed into a price field. Accepts "1,234.50", "$12",
 * "12.5", "-3", "(5.00)", and a decimal comma ("12,50", "1.234,50", the
 * decimal key on many phone keypads). Returns integer cents, or null when
 * nothing usable was typed.
 */
export function parseMoney(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    // Through the decimal string, so 1.005 is 1.005 and not 1.00499999.
    return /e/i.test(String(input)) ? Math.round(input * 100) : parseMoney(String(input));
  }
  if (typeof input !== 'string') return null;
  const text = input.trim();
  // A minus sign (or U+2212) before the first digit, or parentheses around the whole amount.
  const negative = /^[^\d]*[-\u2212]/.test(text) || /^[^\d]*\(.*\)\s*$/.test(text);
  const body = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(body)) return null;
  const count = (ch) => body.split(ch).length - 1;
  const lastDot = body.lastIndexOf('.');
  const lastComma = body.lastIndexOf(',');
  // Which mark, if any, separates the cents: the later one when both appear;
  // a single comma followed by one or two digits; a single dot.
  let dec = null;
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0) dec = count(',') === 1 && /^\d{1,2}$/.test(body.slice(lastComma + 1)) ? ',' : null;
  else if (lastDot >= 0) dec = count('.') === 1 ? '.' : null;
  const at = dec ? body.lastIndexOf(dec) : -1;
  const whole = (at >= 0 ? body.slice(0, at) : body).replace(/\D/g, '');
  const frac = at >= 0 ? body.slice(at + 1).replace(/\D/g, '') : '';
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
