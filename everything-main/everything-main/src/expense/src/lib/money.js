import { round2 } from './util.js';

const fmtCache = new Map();

export function formatMoney(amount, currency = 'USD', { compact = false, signed = false } = {}) {
  const n = Number(amount) || 0;
  const key = `${currency}|${compact}`;
  let fmt = fmtCache.get(key);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(undefined, {
        style: 'currency', currency,
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 2,
      });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      fmt = { format: (v) => `${currency} ${fmt.format(v)}` };
    }
    fmtCache.set(key, fmt);
  }
  const out = fmt.format(Math.abs(n));
  if (n < 0) return `-${out}`;
  return signed && n > 0 ? `+${out}` : out;
}

/**
 * Parse a human-written amount: "1,234.56", "1.234,56", "$ 12", "(12.34)",
 * "12.34-", "-12.34", "EUR 40". Returns a number or null when nothing numeric.
 */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? round2(input) : null;
  let s = String(input ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (/-\s*$/.test(s)) { negative = true; s = s.replace(/-\s*$/, ''); }
  // A minus anywhere before the first digit ("-$12", "$-12", "USD -12")
  if (/^[^\d]*-/.test(s)) negative = true;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    // Whichever separator comes last is the decimal mark.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const commas = (s.match(/,/g) || []).length;
    const after = s.length - lastComma - 1;
    // One comma followed by one or two digits is a decimal mark ("12,5", "12,34");
    // anything else is a thousands separator ("1,234", "1,234,567").
    if (commas === 1 && after > 0 && after < 3) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) s = s.replace(/\.(?=.*\.)/g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

/** Currency-aware total of expenses: Map currency -> amount. */
export function totalsByCurrency(items, pick = (x) => x) {
  const map = new Map();
  for (const item of items) {
    const { amount, currency } = pick(item);
    map.set(currency, round2((map.get(currency) || 0) + (Number(amount) || 0)));
  }
  return map;
}

/** Render a totals map as "€120.00 + $40.00" style text, base currency first. */
export function formatTotals(map, baseCurrency) {
  if (!map || map.size === 0) return formatMoney(0, baseCurrency);
  const keys = [...map.keys()].sort((a, b) => (a === baseCurrency ? -1 : b === baseCurrency ? 1 : a.localeCompare(b)));
  return keys.map((k) => formatMoney(map.get(k), k)).join(' + ');
}
