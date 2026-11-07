/**
 * Finding a receipt the way people actually remember sales: "a blue mug,
 * sometime last week, paid by card" - not receipt #1042.
 *
 * One text box matches the receipt number, any line item's product name,
 * the customer's name, or an exact amount; method and date filters narrow
 * it. The matcher is pure so the month-by-month scan in the view stays a
 * dumb loop, and the rules are testable on their own.
 */

import { matches } from './util.js';
import { parseAmount } from './money.js';
import { receiptPayments } from './payments.js';
import { toCents } from './totals.js';

/** True when the criteria would search for anything at all. */
export function hasCriteria({ text = '', method = null, from = null, to = null } = {}) {
  return !!(String(text).trim() || method || from || to);
}

export function receiptMatches(receipt, { text = '', method = null, from = null, to = null } = {}) {
  if (from && receipt.date < from) return false;
  if (to && receipt.date > to) return false;
  // A split sale paid partly by card is a hit for "card" - the customer
  // remembers tapping their card, not how the balance was divided.
  if (method && !receiptPayments(receipt).some((t) => t.method === method)) return false;

  const q = String(text).trim();
  if (!q) return true;

  if (String(receipt.number).includes(q)) return true;
  // An exact amount, either sign: refunds store negative totals but the
  // person searching types the figure off the slip.
  const amount = parseAmount(q);
  if (amount !== null && toCents(Math.abs(Number(receipt.total) || 0)) === toCents(amount)) return true;
  if (receipt.customerName && matches(receipt.customerName, q)) return true;
  // Notes are how people remember an order they can't name: "gift wrap",
  // "for Sam". Both the sale's own note and the ones on its lines.
  if (receipt.note && matches(receipt.note, q)) return true;
  return (receipt.lines || []).some((l) => matches(l.name, q) || matches(l.note, q));
}
