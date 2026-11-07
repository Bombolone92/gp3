/**
 * Payment methods, and reading the tenders off a receipt.
 *
 * Separate from the store so anything that summarizes money (drawer, CSV,
 * receipt rendering) can read a receipt without importing the data layer.
 */

import { round2 } from './util.js';

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', icon: 'banknote' },
  { value: 'card', label: 'Card', icon: 'creditCard' },
  { value: 'other', label: 'Other', icon: 'wallet' },
  // Store credit is a tender like any other here - it settles a balance, it
  // reconciles in reports and exports, and a receipt can be found by it. What
  // makes it different is that it needs a customer with a balance to draw on,
  // so the register offers it conditionally (see CREDIT_METHOD's users) rather
  // than as one of the three buttons a cashier always sees.
  { value: 'credit', label: 'Store credit', icon: 'ticket' },
];

/** The tenders every sale can always be settled with, in the register's order. */
export const CASH_METHODS = PAYMENT_METHODS.filter((m) => m.value !== 'credit');

/** Store credit's own entry, for the places that offer it on its own terms. */
export const CREDIT_METHOD = PAYMENT_METHODS.find((m) => m.value === 'credit');

/**
 * Not a method a cashier picks - the presentation for a sale settled by more
 * than one tender, so a list row or a report can label it in one glyph.
 */
export const SPLIT_METHOD = { value: 'split', label: 'Split', icon: 'split' };

export function paymentMethodInfo(method) {
  if (method === SPLIT_METHOD.value) return SPLIT_METHOD;
  // Named, not positional: 'other' is the honest label for a tender this
  // build doesn't recognize, and it must stay that whatever is added above.
  return PAYMENT_METHODS.find((m) => m.value === method)
    || PAYMENT_METHODS.find((m) => m.value === 'other');
}

/**
 * The tenders that settled a receipt, whatever era it was written in.
 *
 * Receipts are immutable history: the pre-split single `payment` shape is
 * normalized here at read time rather than rewritten in the month files.
 */
export function receiptPayments(receipt) {
  if (Array.isArray(receipt?.payments) && receipt.payments.length) return receipt.payments;
  const pay = receipt?.payment;
  if (!pay) return [];
  const one = { method: paymentMethodInfo(pay.method).value, amount: round2(Number(receipt.total) || 0) };
  if (pay.tendered !== undefined) one.tendered = pay.tendered;
  if (pay.change !== undefined) one.change = pay.change;
  return [one];
}

/** 'cash' | 'card' | 'other' | 'split' - how a receipt should be labelled. */
export function paymentKindOf(receipt) {
  const tenders = receiptPayments(receipt);
  if (tenders.length > 1) return SPLIT_METHOD.value;
  return tenders[0]?.method || 'other';
}

/** Total change handed back across a receipt's tenders. */
export function receiptChange(receipt) {
  return round2(receiptPayments(receipt).reduce((a, t) => a + (Number(t.change) || 0), 0));
}

/**
 * Total gratuity recorded across a receipt's tenders.
 *
 * A tip rides on the tender that carried it (`tender.tip`) and is never part
 * of `amount`, so sales totals, tax math, and product reports don't see it.
 */
export function receiptTip(receipt) {
  return round2(receiptPayments(receipt).reduce((a, t) => a + Math.max(0, Number(t.tip) || 0), 0));
}
