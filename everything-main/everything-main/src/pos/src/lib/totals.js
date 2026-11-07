/**
 * Cart math. Everything is computed in integer cents so line totals, the
 * tax breakdown, and the grand total agree to the cent - no float drift,
 * no "subtotal + tax ≠ total" receipts.
 *
 * Discount model:
 *   - a line discount applies to one line (percent of the line, or fixed);
 *   - an order discount applies to the sum of discounted lines and is
 *     prorated across them (largest-remainder) so per-line tax stays exact.
 *
 * Tax model:
 *   - exclusive (default): tax is added on top of the discounted price;
 *   - inclusive: prices already contain tax; the breakdown extracts the
 *     tax portion without changing the total.
 */

export const toCents = (n) => Math.round((Number(n) || 0) * 100);
export const fromCents = (c) => c / 100;

/**
 * A line's usable quantity. Lines sold by measure (they carry a `unit`,
 * e.g. 'kg') take decimals to 3 places; everything else stays whole - the
 * historical contract that keeps stock and refunds in integers.
 */
export function sanitizeQty(qty, unit = '') {
  const n = Math.max(0, Number(qty) || 0);
  return unit ? Math.round(n * 1000) / 1000 : Math.round(n);
}

/** A discount object is usable when it has a positive value of a known type. */
export function validDiscount(d) {
  if (!d || (d.type !== 'percent' && d.type !== 'fixed')) return false;
  const v = Number(d.value);
  if (!Number.isFinite(v) || v <= 0) return false;
  return d.type !== 'percent' || v <= 100;
}

/** Cents taken off `baseCents` by a discount; capped so lines never go negative. */
export function discountCents(baseCents, discount) {
  if (!validDiscount(discount)) return 0;
  const raw = discount.type === 'percent'
    ? Math.round(baseCents * Number(discount.value) / 100)
    : toCents(discount.value);
  return Math.max(0, Math.min(baseCents, raw));
}

/**
 * Split `totalCents` across `weights` proportionally, largest remainder:
 * the parts always sum exactly to the total, and no share exceeds its weight
 * (so a prorated discount can never push a line below zero).
 */
export function allocate(totalCents, weights) {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0 || totalCents <= 0) return weights.map(() => 0);
  const capped = Math.min(totalCents, sum);
  const exact = weights.map((w) => capped * w / sum);
  const parts = exact.map(Math.floor);
  let left = capped - parts.reduce((a, p) => a + p, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (parts[i] < weights[i]) { parts[i]++; left--; }
  }
  return parts;
}

/** Tax cents on `taxableCents` at `rate`% under the given price mode. */
function taxCents(taxableCents, rate, pricesIncludeTax) {
  if (!rate || taxableCents <= 0) return 0;
  if (pricesIncludeTax) {
    return taxableCents - Math.round(taxableCents / (1 + rate / 100));
  }
  return Math.round(taxableCents * rate / 100);
}

/**
 * Compute a whole cart.
 *
 * lines: [{ name, unitPrice, qty, taxRate = 0, taxName = '', discount = null, ... }]
 * opts:  { orderDiscount = null, pricesIncludeTax = false }
 *
 * Returns amounts as floats (dollars) ready for display and storage:
 * {
 *   lines: [{ ...line, subtotal, discountAmount, taxable, tax, total }],
 *   itemCount, subtotal, lineDiscountTotal, orderDiscountAmount,
 *   discountTotal, taxTotal, taxes: [{ rate, name, taxable, tax }], total,
 * }
 */
export function computeCart(lines, { orderDiscount = null, pricesIncludeTax = false } = {}) {
  const rows = (lines || []).map((line) => {
    const qty = sanitizeQty(line.qty, line.unit);
    // Rounded once, half-up, so a measured line (0.735 × $12.00/kg) lands on
    // exact cents here and everything downstream stays integer arithmetic.
    const baseCents = Math.round(toCents(line.unitPrice) * qty);
    const discCents = discountCents(baseCents, line.discount);
    return { line, qty, baseCents, discCents, netCents: baseCents - discCents };
  });

  const netSum = rows.reduce((a, r) => a + r.netCents, 0);
  const orderDiscCents = discountCents(netSum, orderDiscount);
  const shares = allocate(orderDiscCents, rows.map((r) => r.netCents));

  const taxMap = new Map();
  let subtotalCents = 0;
  let lineDiscCents = 0;
  let taxTotalCents = 0;
  let itemCount = 0;

  const outLines = rows.map((r, i) => {
    const taxableCents = r.netCents - shares[i];
    const rate = Number(r.line.taxRate) || 0;
    const lineTaxCents = taxCents(taxableCents, rate, pricesIncludeTax);
    subtotalCents += r.baseCents;
    lineDiscCents += r.discCents;
    taxTotalCents += lineTaxCents;
    // A weighed line is one item in the basket, however many kilos it holds.
    itemCount += r.line.unit ? (r.qty > 0 ? 1 : 0) : r.qty;

    if (rate > 0 && taxableCents > 0) {
      const key = `${rate}|${r.line.taxName || ''}`;
      const bucket = taxMap.get(key) || { rate, name: r.line.taxName || '', taxable: 0, tax: 0 };
      bucket.taxable += taxableCents;
      bucket.tax += lineTaxCents;
      taxMap.set(key, bucket);
    }

    return {
      ...r.line,
      qty: r.qty,
      subtotal: fromCents(r.baseCents),
      discountAmount: fromCents(r.discCents + shares[i]),
      taxable: fromCents(taxableCents),
      tax: fromCents(lineTaxCents),
      total: fromCents(taxableCents + (pricesIncludeTax ? 0 : lineTaxCents)),
    };
  });

  const taxableSum = netSum - orderDiscCents;
  const totalCents = pricesIncludeTax ? taxableSum : taxableSum + taxTotalCents;

  return {
    lines: outLines,
    itemCount,
    subtotal: fromCents(subtotalCents),
    lineDiscountTotal: fromCents(lineDiscCents),
    orderDiscountAmount: fromCents(orderDiscCents),
    discountTotal: fromCents(lineDiscCents + orderDiscCents),
    taxTotal: fromCents(taxTotalCents),
    taxes: [...taxMap.values()]
      .sort((a, b) => a.rate - b.rate)
      .map((t) => ({ ...t, taxable: fromCents(t.taxable), tax: fromCents(t.tax) })),
    total: fromCents(totalCents),
  };
}

/** Change due on a cash payment; null while tendered doesn't cover the total. */
export function changeDue(total, tendered) {
  const t = toCents(tendered);
  const owed = toCents(total);
  if (t < owed) return null;
  return fromCents(t - owed);
}

/**
 * Sensible quick-tender amounts for a cash total: the exact amount plus
 * the next round bills, deduped and ascending.
 */
export function tenderSuggestions(total) {
  const owed = Math.max(0, Number(total) || 0);
  // Snapped to cents the same way changeDue counts them: float dust in
  // `total * 100` must not bump the exact-amount chip a cent over the total.
  const opts = new Set([fromCents(toCents(owed))]);
  for (const step of [1, 5, 10, 20, 50, 100]) {
    const up = Math.ceil(owed / step) * step;
    if (up > owed) opts.add(up);
  }
  return [...opts].sort((a, b) => a - b).slice(0, 4);
}
