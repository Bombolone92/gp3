/**
 * Costs on work orders and service entries. All money is integer cents.
 *
 * A line item is one service task with its labor and parts:
 *   { id, taskId, description,
 *     laborHours, laborRate (cents/hr), laborCost (cents, used when no hours),
 *     parts: [{ id, partId, name, qty, unitCost (cents) }] }
 *
 * A document adds { discount: { type: 'percent' | 'amount', value }, taxPercent }.
 */
import { roundCents } from './money.js';

export function lineLabor(li) {
  const hours = Number(li?.laborHours) || 0;
  const rate = Number(li?.laborRate) || 0;
  if (hours > 0 && rate > 0) return roundCents(hours * rate);
  return roundCents(Number(li?.laborCost) || 0);
}

export function lineParts(li) {
  let sum = 0;
  for (const p of li?.parts || []) sum += roundCents((Number(p.qty) || 0) * (Number(p.unitCost) || 0));
  return sum;
}

export function lineTotal(li) {
  return lineLabor(li) + lineParts(li);
}

export function docTotals(doc) {
  let labor = 0;
  let parts = 0;
  for (const li of doc?.lineItems || []) {
    labor += lineLabor(li);
    parts += lineParts(li);
  }
  const subtotal = labor + parts;
  const d = doc?.discount;
  let discount = 0;
  if (d && Number(d.value) > 0) {
    discount = d.type === 'amount' ? roundCents(Number(d.value)) : roundCents((subtotal * Math.min(100, Number(d.value))) / 100);
  }
  // Between nothing and the whole subtotal (a credit has nothing to discount).
  discount = Math.max(0, Math.min(discount, subtotal));
  const taxable = subtotal - discount;
  const tax = roundCents((taxable * (Number(doc?.taxPercent) || 0)) / 100);
  return { labor, parts, subtotal, discount, tax, total: taxable + tax };
}

/** Parts used by a document, summed per part: Map(partId -> qty). */
export function partsUsed(doc) {
  const out = new Map();
  for (const li of doc?.lineItems || []) {
    for (const p of li.parts || []) {
      if (!p.partId) continue;
      out.set(p.partId, (out.get(p.partId) || 0) + (Number(p.qty) || 0));
    }
  }
  return out;
}

/** Purchase order totals: { subtotal, tax, shipping, total }. */
export function poTotals(po) {
  let subtotal = 0;
  for (const it of po?.items || []) subtotal += roundCents((Number(it.qty) || 0) * (Number(it.unitCost) || 0));
  const tax = roundCents((subtotal * (Number(po?.taxPercent) || 0)) / 100);
  const shipping = roundCents(Number(po?.shipping) || 0);
  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}
