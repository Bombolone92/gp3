/**
 * Money is stored as integer cents everywhere. Floats only appear at the
 * edges: parsing what a person typed and formatting for display.
 */

const formatters = new Map();
let defaults = { currency: 'USD', locale: undefined };

function formatter(currency, locale, extra = '') {
  const key = `${locale}|${currency}|${extra}`;
  let f = formatters.get(key);
  if (!f) {
    const opts = { style: 'currency', currency };
    if (extra === 'short') Object.assign(opts, { notation: 'compact', maximumFractionDigits: 1 });
    try {
      f = new Intl.NumberFormat(locale, opts);
    } catch {
      // A malformed code (from an old backup, say) must not break every
      // amount on screen: show the generic currency sign instead.
      f = new Intl.NumberFormat(locale, { ...opts, currency: 'XXX' });
    }
    formatters.set(key, f);
  }
  return f;
}

export function setMoneyDefaults({ currency, locale } = {}) {
  if (currency) defaults.currency = currency;
  if (locale !== undefined) defaults.locale = locale;
}

export function currentCurrency() {
  return defaults.currency;
}

/** 12345 -> "$123.45" */
export function formatMoney(cents, currency = defaults.currency, locale = defaults.locale) {
  return formatter(currency, locale).format((Number.isFinite(cents) ? cents : 0) / 100);
}

/** Compact form for charts and tiles: 1234500 -> "$12.3K". */
export function formatMoneyShort(cents, currency = defaults.currency, locale = defaults.locale) {
  return formatter(currency, locale, 'short').format((Number.isFinite(cents) ? cents : 0) / 100);
}

/**
 * Parse a typed amount. Accepts "1,234.50", "$12", "12.5", "-3", "(4.00)",
 * and a decimal comma ("12,50", "1.234,56"): a last comma followed by one
 * or two digits is the decimal point. Returns integer cents, or null when
 * nothing usable was typed.
 */
export function parseMoney(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== 'string') return null;
  // A minus anywhere before the first digit: "-5", "$-5", "€ -12,50".
  const negative = /^[^0-9]*-|\(.*\)/.test(input);
  let digits = input.replace(/[^0-9.,]/g, '');
  const comma = digits.lastIndexOf(',');
  if (comma > digits.lastIndexOf('.') && /,\d{1,2}$/.test(digits)) digits = `${digits.slice(0, comma).replace(/[.,]/g, '')}.${digits.slice(comma + 1)}`;
  const cleaned = digits.replace(/,/g, '');
  if (!cleaned || cleaned === '.') return null;
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (Number(frac[2] ?? 0) >= 5 ? 1 : 0);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Cents to a plain editable string: 12345 -> "123.45"; whole yen without ".00". */
export function centsToInput(cents, currency = defaults.currency) {
  if (!Number.isFinite(cents)) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  if (abs % 100 === 0 && centsStep(currency) === 100) return `${sign}${abs / 100}`;
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Round half away from zero to whole cents. */
export function roundCents(value) {
  return Math.sign(value) * Math.round(Math.abs(value));
}

const steps = new Map();

/**
 * The smallest amount of a currency, in cents: 1 for dollars or euros, 100
 * for currencies without a minor unit such as the yen. Computed amounts
 * round to it, so a yen bill never carries fractions of a yen.
 */
export function centsStep(currency = defaults.currency) {
  let step = steps.get(currency);
  if (step === undefined) {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
    } catch {
      // Unknown code: keep cents.
    }
    step = 10 ** Math.max(0, 2 - digits);
    steps.set(currency, step);
  }
  return step;
}

/**
 * cents × factor ÷ divisor, rounded half away from zero to whole cents (whole
 * units of a currency without cents, see centsStep). The
 * factor is taken to six decimals and the math is done in integers, so an
 * exact half cent (6.35% of $410.00 = $26.035) is never lost to binary
 * floating point error.
 */
export function mulCents(cents, factor, divisor = 1) {
  const c = Math.round(Number(cents));
  const f = Math.round((Number(factor) || 0) * 1e6);
  if (!Number.isFinite(c) || !Number.isFinite(f)) return 0;
  const step = centsStep();
  const dn = Math.round(divisor * 1e6) * step;
  const nn = c * f;
  if (Number.isSafeInteger(nn)) {
    // Exact in plain numbers: the quotient is truncated toward zero and the remainder is exact.
    const q = Math.trunc(nn / dn);
    const r = nn - q * dn;
    return (Math.abs(r) * 2 >= dn ? q + Math.sign(nn) : q) * step;
  }
  const n = BigInt(c) * BigInt(f);
  const d = BigInt(dn);
  const q = n / d;
  const r = n % d;
  return Number((r < 0n ? -r : r) * 2n >= d ? q + (n < 0n ? -1n : 1n) : q) * step;
}

/** Percentage of an amount in cents, rounded to whole cents. pct is 0-100. */
export function percentOf(cents, pct) {
  return mulCents(cents, pct, 100);
}
