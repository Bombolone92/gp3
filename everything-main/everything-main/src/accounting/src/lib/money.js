/**
 * Money is stored and computed as integer minor units (cents). Floats only
 * appear at the edges: parsing what a person typed, and formatting for display.
 * Every amount in a stored record is an integer, so sums are exact and a
 * balance sheet that balances today still balances after ten thousand edits.
 */

/** Round a float amount in major units to integer cents (half away from zero). */
export function toCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.sign(value) * Math.round(Math.abs(value) * 100 + 1e-7);
  }
  return parseMoney(value);
}

/**
 * Parse text such as "1,234.50", "$ 99", "(45.00)", "-12" or "1.234,50 EUR"
 * into cents. Parentheses mean negative, as on a printed statement. Returns 0
 * for anything unparseable rather than NaN, so a bad cell never poisons a sum.
 */
export function parseMoney(text) {
  if (text === null || text === undefined) return 0;
  let s = String(text).trim();
  if (!s) return 0;
  // The minus sign some locales and bank exports use (U+2212), and other
  // dashes that stand in for it, are a minus too.
  s = s.replace(/[\u2212\u2012\u2013\uFE63\uFF0D]/g, '-');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.includes('-')) negative = !negative;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return 0;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalSep = null;
  if (lastDot >= 0 && lastComma >= 0) decimalSep = lastDot > lastComma ? '.' : ',';
  else if (lastComma >= 0) {
    // "1,234" is a thousands group; "12,5" or "12,50" is a decimal comma.
    const tail = s.length - lastComma - 1;
    decimalSep = tail === 3 && s.indexOf(',') === lastComma ? null : tail <= 2 ? ',' : null;
  } else if (lastDot >= 0) {
    const tail = s.length - lastDot - 1;
    const dots = s.split('.').length - 1;
    decimalSep = dots > 1 && tail === 3 ? null : '.';
  }
  let intPart = s;
  let fracPart = '';
  if (decimalSep) {
    const at = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, at);
    fracPart = s.slice(at + 1);
  }
  intPart = intPart.replace(/[.,]/g, '') || '0';
  fracPart = (fracPart.replace(/[.,]/g, '') + '00');
  // Round on the third decimal so "10.005" is 1001 cents, not 1000.
  let cents = Number(intPart) * 100 + Number(fracPart.slice(0, 2));
  if (Number(fracPart[2] || 0) >= 5) cents += 1;
  if (!Number.isFinite(cents)) return 0;
  return negative ? -cents : cents;
}

const formatters = new Map();
function formatter(currency, locale, plain) {
  const key = `${currency}|${locale}|${plain}`;
  let f = formatters.get(key);
  if (!f) {
    f = plain
      ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(key, f);
  }
  return f;
}

let defaults = { currency: 'USD', locale: undefined };
export function currentCurrency() {
  return defaults.currency;
}
export function setMoneyDefaults({ currency, locale } = {}) {
  if (currency) defaults.currency = currency;
  if (locale !== undefined) defaults.locale = locale;
}

/** "$1,234.50" from 123450. Negative amounts use a leading minus sign. */
export function formatMoney(cents, { currency = defaults.currency, locale = defaults.locale, plain = false } = {}) {
  const n = (cents || 0) / 100;
  try {
    return formatter(currency, locale, plain).format(n === 0 ? 0 : n);
  } catch {
    return formatter('USD', locale, plain).format(n);
  }
}

/** Plain number for inputs: "1234.50". */
export function centsToInput(cents) {
  if (cents === null || cents === undefined || cents === '') return '';
  // A rate can carry fractions of a cent (an amount spread over a quantity);
  // show them rather than mangling them.
  if (!Number.isInteger(cents)) return String(Number((cents / 100).toFixed(6)));
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** qty x rate, where rate is in cents (may be fractional) and qty a float. */
export function lineAmount(qty, rateCents) {
  const q = Number(qty);
  const r = Number(rateCents);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return 0;
  // Half a cent rounds away from zero, as toCents does. The nudge absorbs
  // float error such as 0.285 x 100 = 28.499999999999996.
  const x = q * r;
  return Math.sign(x) * Math.round(Math.abs(x) + 1e-6) || 0;
}

/** Sum an array of cents (or of objects via a getter). */
export function sum(list, get) {
  let total = 0;
  if (!list) return 0;
  for (const x of list) total += (get ? get(x) : x) || 0;
  return total;
}

/**
 * Split `total` cents across `weights` so the parts add up to exactly
 * `total`, using the largest-remainder method. Used to prorate a payment
 * across an invoice's lines for cash-basis reporting, where a rounding cent
 * that went missing would make the report disagree with the bank.
 */
export function allocate(total, weights) {
  const n = weights.length;
  if (!n) return [];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    const out = new Array(n).fill(0);
    out[0] = total;
    return out;
  }
  // Signed weights work as they are: a discount line takes a negative share.
  // Flooring every exact share leaves a non-negative whole remainder, which
  // goes one cent at a time to the shares that lost the most to the floor.
  const raw = weights.map((w) => (total * w) / weightSum);
  const out = raw.map((r) => Math.floor(r + 1e-9));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r + 1e-9), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % n, rest--) out[order[k][1]] += 1;
  return out;
}

/** Percentage stored as basis points (8.25% = 825) applied to cents. */
export function applyRate(cents, basisPoints) {
  return Math.round((cents * (basisPoints || 0)) / 10000);
}

/** A quantity as typed: "1.5", "1,5", or "1,000". */
export function parseQty(text) {
  let t = String(text || '').trim().replace(/\s/g, '');
  if (!t) return '';
  if (t.includes(',') && !t.includes('.')) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : '';
}

