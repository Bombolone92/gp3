/**
 * Payment links. The app doesn't process money itself; it builds links to
 * wherever the user already gets paid (PayPal.me or any custom checkout URL
 * with placeholders), pre-filled with the invoice amount.
 */

import { docTotals } from './money.js';

/**
 * cfg: { kind: 'none' | 'paypal' | 'custom', value: string }
 *  - paypal: value is the PayPal.me username (a pasted full URL also works)
 *  - custom: value is a URL template; {amount}, {currency}, {number} are
 *    replaced. A template without placeholders is returned as-is.
 * Returns the URL string, or null when no link can be built.
 */
export function paymentLink(cfg, { amount, currency = 'USD', number = '' } = {}) {
  const value = String(cfg?.value || '').trim();
  if (!cfg || cfg.kind === 'none' || !value) return null;
  const amt = (Math.round((Number(amount) || 0) * 100) / 100).toFixed(2);
  if (Number(amt) <= 0) return null;

  if (cfg.kind === 'paypal') {
    const user = value
      .replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '')
      .replace(/^@/, '')
      .split(/[/?#]/)[0]
      .trim();
    if (!user) return null;
    return `https://paypal.me/${encodeURIComponent(user)}/${amt}${encodeURIComponent(currency)}`;
  }

  const url = value
    .replaceAll('{amount}', amt)
    .replaceAll('{currency}', encodeURIComponent(currency))
    .replaceAll('{number}', encodeURIComponent(number));
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/**
 * The pay-online link for one document's current state, or null. Every place
 * that hands a document's link out (the paper, the PDF, the email, the public
 * share page) derives it here, so they can never disagree. A void invoice
 * asks for nothing — its balance never went to zero, but the money is no
 * longer owed — and paymentLink() itself already returns null once nothing
 * is due.
 *
 * A requested deposit prefills the link while nothing has been paid; from
 * the first payment on, the link asks for the remaining balance as always.
 */
export function docPayLink(settings, doc) {
  if (!doc || doc.status === 'void') return null;
  const { balance, deposit, paid } = docTotals(doc);
  return paymentLink(settings?.paymentLink, {
    // "Nothing has been paid" is |paid| ≈ 0, exactly as the paper and the
    // PDF gate their deposit row: the net can be negative once a payment is
    // deleted out from under its refund, and the paper then shows the full
    // balance due — the link must ask for the same number.
    amount: deposit > 0.005 && Math.abs(paid) <= 0.005 ? deposit : balance,
    currency: doc.currency,
    number: doc.number,
  });
}

/**
 * The "how to pay" text printed on an invoice: the client's own payment
 * instructions when they have any, the global ones otherwise. Free-form,
 * because bank details differ by country (IBAN, sort code, routing…).
 *
 * Shown under the same rule as docPayLink: only on an invoice that still
 * asks for money. A settled or void invoice must not tell the client how
 * to send more, and an estimate is not a request for payment at all.
 */
export function docPaymentInstructions(settings, doc, client = null) {
  if (!doc || doc.kind !== 'invoice' || doc.status === 'void') return null;
  if (docTotals(doc).balance <= 0.005) return null;
  // A restored backup can carry anything here; a non-string is nothing to
  // print, not a reason for every invoice page to throw.
  const str = (v) => (typeof v === 'string' ? v : '').trim();
  const text = str(client?.paymentInstructions) || str(settings?.paymentInstructions);
  return text || null;
}
