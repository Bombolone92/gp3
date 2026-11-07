/**
 * Returns and refunds.
 *
 * A void says the sale never happened. A refund says money went back over the
 * counter - so it gets its own receipt, its own sequential number, and its own
 * place in the month file, with every amount negative. Reports then net it out
 * of revenue simply by adding it up, and the original stays exactly as it was
 * rung up.
 *
 * Money is taken from the *original line's stored amounts*, never recomputed
 * from today's catalog: the customer is owed what they paid, including their
 * share of a line discount and of an order discount, at the tax rate in force
 * that day.
 *
 * Partial refunds allocate cumulatively - the share for "units 1..n refunded
 * so far" minus the share already given - so returning three units one at a
 * time refunds exactly what returning all three at once would, to the cent,
 * with nothing left stranded by rounding.
 */

import { toCents, fromCents, sanitizeQty } from './totals.js';
import { round2 } from './util.js';

export const isRefund = (receipt) => receipt?.type === 'refund';

/** A quantity in this line's own terms: whole units, or 3 decimals by measure. */
const lineQty = (line, value) => sanitizeQty(value, line?.unit);

/** Units of a sold line already given back. */
export function refundedQty(line) {
  return lineQty(line, line?.refundedQty);
}

/** Units of a sold line still refundable. */
export function refundableQty(line) {
  return lineQty(line, lineQty(line, line?.qty) - refundedQty(line));
}

/** 'none' | 'partial' | 'full' - how much of a sale has come back. */
export function refundState(receipt) {
  if (!receipt || isRefund(receipt)) return 'none';
  const lines = receipt.lines || [];
  const sold = lines.reduce((a, l) => a + lineQty(l, l.qty), 0);
  const back = lines.reduce((a, l) => a + refundedQty(l), 0);
  if (!back) return 'none';
  // Sums of 3-decimal quantities can carry float dust; a hair's width is equal.
  return back >= sold - 1e-9 ? 'full' : 'partial';
}

/**
 * Whether a Refund action makes any sense for this receipt.
 *
 * A sale still sitting in the offline outbox is excluded: the refund would be
 * filed in the cloud while the record of how much of the sale has come back
 * lives only on this device, so a reload could hand the same money back twice.
 * It becomes refundable the moment it syncs.
 */
export function canRefund(receipt) {
  return !!receipt && !isRefund(receipt) && !receipt.voidedAt
    && !receipt.pendingSync && refundState(receipt) !== 'full';
}

/** Everything still refundable: the default the dialog opens on. */
export function fullRefundPicks(receipt) {
  return (receipt?.lines || [])
    .map((line, index) => ({ index, qty: refundableQty(line) }))
    .filter((p) => p.qty > 0);
}

/**
 * Price a refund of `picks` ([{ index, qty }]) against `receipt`.
 *
 * Returns stored-shape lines and totals, all negative, plus the quantities to
 * put back on the shelf. Quantities are negative too, so every aggregation in
 * the app - revenue, top products, payments - nets refunds out by summing.
 */
export function refundPlan(receipt, picks) {
  const includesTax = !!receipt?.pricesIncludeTax;
  const taxes = new Map();
  const restock = [];
  const lines = [];
  let subCents = 0;
  let discCents = 0;
  let taxCents = 0;
  let units = 0;

  // One pick per line: two picks naming the same index would each be priced
  // as if the other didn't exist - both anchored at the stored refundedQty -
  // and pay the same units back twice inside a single plan.
  const wanted = new Map();
  for (const pick of picks || []) {
    const index = Number(pick?.index);
    if (!Number.isInteger(index) || index < 0) continue;
    wanted.set(index, (wanted.get(index) || 0) + (Number(pick?.qty) || 0));
  }

  for (const [index, pickQty] of wanted) {
    const src = receipt?.lines?.[index];
    if (!src) continue;
    const sold = lineQty(src, src.qty);
    if (sold <= 0) continue;
    const qty = Math.min(lineQty(src, pickQty), refundableQty(src));
    if (!qty) continue;

    const already = refundedQty(src);
    // Cumulative share: what n units are owed, less what was already given.
    // Works the same for measured lines - n is then kilos, not units.
    const share = (amount) => {
      const cents = toCents(amount);
      const upto = (n) => Math.round((cents * n) / sold);
      return upto(already + qty) - upto(already);
    };

    // The subtotal allocates cumulatively too: for whole units this is
    // exactly unitPrice × qty as before, and for measured lines it makes
    // partial returns sum to the original's cents with nothing stranded.
    const lineSub = share(src.subtotal);
    const lineDisc = share(src.discountAmount);
    const lineTax = share(src.tax);
    const taxable = lineSub - lineDisc;
    const lineTotal = taxable + (includesTax ? 0 : lineTax);

    subCents += lineSub;
    discCents += lineDisc;
    taxCents += lineTax;
    // Mirror of the cart's rule: a weighed line counts as one item.
    units += src.unit ? 1 : qty;

    const rate = Number(src.taxRate) || 0;
    if (rate > 0 && taxable > 0) {
      const key = `${rate}|${src.taxName || ''}`;
      const bucket = taxes.get(key) || { rate, name: src.taxName || '', taxable: 0, tax: 0 };
      bucket.taxable += taxable;
      bucket.tax += lineTax;
      taxes.set(key, bucket);
    }

    const line = {
      productId: src.productId || null,
      name: src.name,
      unitPrice: round2(Number(src.unitPrice) || 0),
      qty: -qty,
      taxRate: rate,
      taxName: src.taxName || '',
      discount: src.discount || null,
      subtotal: fromCents(-lineSub),
      discountAmount: fromCents(-lineDisc),
      tax: fromCents(-lineTax),
      total: fromCents(-lineTotal),
      // Which line of the original came back, for its bookkeeping.
      refundOfLine: index,
    };
    if (src.unit) line.unit = src.unit;
    // What was asked for comes back with the goods: a refund line for "one
    // decaf flat white" has to say which of the two flat whites it was.
    if (src.note) line.note = String(src.note);
    // The cost the sale recorded comes back with the goods, so profit nets
    // out the same way revenue does. Today's catalog is never consulted: this
    // is that sale reversing, at the money it was rung up with.
    if (src.unitCost !== null && src.unitCost !== undefined && Number.isFinite(Number(src.unitCost))) {
      line.unitCost = round2(Number(src.unitCost));
    }
    if (src.options?.length) line.options = src.options.map((o) => ({ ...o }));
    lines.push(line);

    if (src.productId) restock.push({ productId: src.productId, qty });
  }

  const totalCents = subCents - discCents + (includesTax ? 0 : taxCents);
  return {
    lines,
    restock,
    itemCount: -units,
    subtotal: fromCents(-subCents),
    discountTotal: fromCents(-discCents),
    taxTotal: fromCents(-taxCents),
    taxes: [...taxes.values()]
      .sort((a, b) => a.rate - b.rate)
      .map((t) => ({ rate: t.rate, name: t.name, taxable: fromCents(-t.taxable), tax: fromCents(-t.tax) })),
    total: fromCents(-totalCents),
  };
}
