/**
 * Line-item math shared by quotes, jobs and invoices. All amounts are
 * integer cents; quantities may be fractional (2.5 hours).
 *
 * item: { qty, unitPrice, unitCost?, optional?, selected?, taxable? }
 * discount: { type: 'pct' | 'amt', value } (pct is a percentage, amt cents)
 * taxRate: percentage, e.g. 8.25
 * deposit: { type: 'pct' | 'amt', value }
 */
import { roundCents } from './money.js';

export function lineTotal(item) {
  const qty = Number(item?.qty) || 0;
  const price = Number(item?.unitPrice) || 0;
  return roundCents(qty * price);
}

export function lineCost(item) {
  const qty = Number(item?.qty) || 0;
  const cost = Number(item?.unitCost) || 0;
  return roundCents(qty * cost);
}

/** Optional items only count once the client (or you) selected them. */
export function isIncluded(item) {
  return !item?.optional || item?.selected === true;
}

export function discountAmount(subtotal, discount) {
  if (!discount || !discount.value) return 0;
  const raw = discount.type === 'pct'
    ? roundCents((subtotal * Math.min(100, Math.max(0, Number(discount.value)))) / 100)
    : Math.round(Number(discount.value));
  return Math.max(0, Math.min(subtotal, raw));
}

export function computeTotals(doc = {}) {
  const items = (doc.items || []).filter(isIncluded);
  const subtotal = items.reduce((s, it) => s + lineTotal(it), 0);
  const taxableBase = items.filter((it) => it.taxable !== false).reduce((s, it) => s + lineTotal(it), 0);
  const cost = items.reduce((s, it) => s + lineCost(it), 0);
  const discount = discountAmount(subtotal, doc.discount);
  // Spread the discount proportionally so tax only applies to the
  // discounted taxable share.
  const taxableAfterDiscount = subtotal > 0 ? taxableBase - roundCents((discount * taxableBase) / subtotal) : 0;
  const rate = Number(doc.taxRate) || 0;
  const tax = rate > 0 ? roundCents((taxableAfterDiscount * rate) / 100) : 0;
  const total = subtotal - discount + tax;
  let deposit = 0;
  if (doc.deposit && doc.deposit.value) {
    deposit = doc.deposit.type === 'pct'
      ? roundCents((total * Math.min(100, Number(doc.deposit.value))) / 100)
      : Math.min(total, Math.round(Number(doc.deposit.value)));
    deposit = Math.max(0, deposit || 0);
  }
  return { subtotal, discount, tax, total, cost, deposit, profit: subtotal - discount - cost };
}

// Paid totals per invoice, built once per payments list. The store hands out
// a new list whenever payments change, so a cached map never goes stale, and
// pages listing many invoices no longer scan every payment for each one.
const paidByList = new WeakMap();

/** Amount paid toward an invoice from the payments collection. */
export function amountPaid(invoiceId, payments) {
  let paid = paidByList.get(payments);
  if (!paid) {
    paid = new Map();
    for (const p of payments) if (p.invoiceId && !p.voided) paid.set(p.invoiceId, (paid.get(p.invoiceId) || 0) + (p.amount || 0));
    paidByList.set(payments, paid);
  }
  return paid.get(invoiceId) || 0;
}
