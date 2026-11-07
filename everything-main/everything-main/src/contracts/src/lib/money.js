/**
 * Currency codes and per-currency totals.
 *
 * Contract values are never summed across currencies: €50,000 + $50,000 is
 * two totals, not one. A single comparable figure is available only when the
 * user has entered their own rates, and is always labelled as an estimate.
 */

/** Suggestions for the code input — any three-letter code is still accepted. */
export const COMMON_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY',
  'CNY', 'INR', 'SGD', 'NZD', 'ZAR', 'BRL', 'MXN', 'PLN', 'AED', 'ILS',
];

export function isCurrencyCode(code) {
  return /^[A-Za-z]{3}$/.test(String(code ?? '').trim());
}

/** 'eur' → 'EUR'; anything that isn't a three-letter code → `fallback`. */
export function normalizeCurrency(code, fallback = 'USD') {
  const c = String(code ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fallback;
}

/**
 * A { USD: 84000, EUR: 19200 } map as [{ currency, amount }], largest first.
 * Empty and non-positive totals are dropped: they say nothing.
 */
export function sortedTotals(byCurrency) {
  return Object.entries(byCurrency || {})
    .map(([currency, amount]) => ({ currency, amount: Number(amount) }))
    .filter(({ amount }) => Number.isFinite(amount) && amount > 0)
    .sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency));
}

/**
 * Convert a per-currency map into one figure using the user's own rates.
 * `rates` is { EUR: { rate: 1.08, at: '2026-08-06' } }, read as
 * "1 EUR = 1.08 <target>".
 *
 * Returns { total, missing }: `total` is null whenever any currency lacks a
 * rate, because a partial sum presented as a total is exactly the lie this
 * whole feature exists to prevent.
 */
export function convertTotals(byCurrency, target, rates = {}) {
  const code = normalizeCurrency(target, '');
  if (!code) return { total: null, missing: [] };
  let sum = 0;
  const missing = [];
  for (const { currency, amount } of sortedTotals(byCurrency)) {
    if (currency === code) {
      sum += amount;
      continue;
    }
    const rate = Number(rates?.[currency]?.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
      missing.push(currency);
      continue;
    }
    sum += amount * rate;
  }
  return { total: missing.length ? null : sum, missing };
}
