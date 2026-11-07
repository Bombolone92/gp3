/**
 * Tax collected, broken down by rate - the shape a sales-tax, VAT, or GST
 * return is filed in.
 *
 * Reports could say what a period's tax came to and nothing about how it
 * divided, which leaves the actual filing to a spreadsheet. Every receipt
 * already carries the pieces; this puts them in rows.
 *
 * Computed from the *lines*, not from `receipt.taxes`: a cart only files a
 * tax bucket where a rate was actually charged, so tax-free and zero-rated
 * sales - lines a return usually wants on their own line - appear nowhere in
 * those buckets. Line arithmetic is also the same in both price modes:
 *
 *   gross = line.total          (what the customer paid for that line)
 *   tax   = line.tax
 *   base  = line.total − line.tax
 *
 * With tax added on top, `total` is base + tax; with tax inside the price,
 * `total` is the gross and the tax sits within it. Either way the three
 * columns agree, and their totals reconcile with the receipt's own - and so
 * with the Revenue and Tax collected tiles above the card.
 *
 * Refunds carry negative amounts at the rate the original sale was rung up
 * at, so a rate change mid-quarter cannot corrupt the figure: they net
 * themselves out by being added up.
 */

import { toCents, fromCents } from './totals.js';
import { round2 } from './util.js';

/** Sorts rated rows by rate then name, with the unrated buckets last. */
function compareRows(a, b) {
  if (a.kind !== b.kind) return a.kind === 'rate' ? -1 : 1;
  return a.rate - b.rate || String(a.name).localeCompare(String(b.name));
}

/**
 * taxSummary(sales) - one row per rate charged, plus a row for zero-rated
 * sales (a named rate of 0%) and one for tax-free sales (no rate at all),
 * which a return asks about separately.
 *
 * Voided sales are excluded, as everywhere else. Amounts come back as
 * dollars, summed in cents.
 */
export function taxSummary(sales) {
  const rows = new Map();
  let baseCents = 0;
  let taxCents = 0;
  let grossCents = 0;
  /** True when any receipt in the period was rung up tax-inclusive. */
  let anyInclusive = false;
  let anyExclusive = false;

  for (const sale of sales || []) {
    if (sale?.voidedAt) continue;
    if (sale.pricesIncludeTax) anyInclusive = true;
    else anyExclusive = true;
    for (const line of sale.lines || []) {
      const gross = toCents(line.total);
      const tax = toCents(line.tax);
      const base = gross - tax;
      const rate = Number(line.taxRate) || 0;
      const name = String(line.taxName || '').trim();
      // A named 0% rate is zero-rated trade; no rate at all is tax-free.
      // Filings ask about the two separately, and a shop that marks products
      // tax-free is not the same as one charging a zero rate on them.
      const kind = rate > 0 ? 'rate' : name ? 'zero' : 'free';
      const key = kind === 'free' ? 'free' : `${kind}|${name}|${rate}`;
      const row = rows.get(key) || {
        key,
        kind,
        rate,
        name: kind === 'free' ? 'Tax-free' : name || 'Tax',
        base: 0,
        tax: 0,
        gross: 0,
      };
      row.base += base;
      row.tax += tax;
      row.gross += gross;
      rows.set(key, row);
      baseCents += base;
      taxCents += tax;
      grossCents += gross;
    }
  }

  return {
    rows: [...rows.values()]
      .sort(compareRows)
      .map((r) => ({ ...r, base: fromCents(r.base), tax: fromCents(r.tax), gross: fromCents(r.gross) })),
    base: fromCents(baseCents),
    tax: fromCents(taxCents),
    gross: fromCents(grossCents),
    // Which figures to lead with: a tax-inclusive shop reads its return off
    // the gross taken and the tax within it, because that is how its
    // receipts read. A period can hold both, if the setting changed mid-way.
    inclusive: anyInclusive,
    mixed: anyInclusive && anyExclusive,
    any: rows.size > 0,
  };
}

/** 'Sales tax 7.75%' / 'Zero-rated (Export)' / 'Tax-free' - a row's label. */
export function taxRowLabel(row) {
  if (row.kind === 'rate') return `${row.name} ${row.rate}%`;
  if (row.kind === 'zero') return `${row.name} 0%`;
  return 'Tax-free';
}

/**
 * The effective rate a row actually worked out at, for the eye-check a
 * bookkeeper does: tax over base, to two decimals. Null where there is no
 * base to divide by.
 */
export function effectiveRate(row) {
  const base = toCents(row.base);
  if (!base) return null;
  return round2((toCents(row.tax) / base) * 100);
}
