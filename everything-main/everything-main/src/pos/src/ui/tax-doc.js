/**
 * The tax summary as a printable document.
 *
 * Built from the same .rcpt markup as a receipt and the Z-report, so the
 * print stylesheet already knows how to put it on paper - and a shop can hand
 * the slip to its bookkeeper as it stands.
 */

import { el } from './dom.js';
import { formatMoney } from '../lib/money.js';
import { formatDayFull } from '../lib/dates.js';
import { taxRowLabel } from '../lib/tax-report.js';
import { cleanRegistrations } from '../lib/store.js';
import { printDocument } from './receipt.js';

const row = (label, value, cls = '') => el(`div.rcpt-row${cls}`, {},
  el('span', {}, label), el('span', {}, value));

/**
 * taxDocNode(summary, { from, to }, store)
 *
 * `summary` is lib/tax-report.js's taxSummary for the period. Each rate gets
 * its base and its tax; a tax-inclusive shop also gets the gross, because
 * that is the figure its own receipts show and its return is filed on.
 */
export function taxDocNode(summary, { from, to }, store) {
  const s = store.settings;
  const money = (n) => formatMoney(n, s.currency);
  const period = from === to
    ? formatDayFull(from)
    : `${formatDayFull(from)} — ${formatDayFull(to)}`;
  const registrations = cleanRegistrations(s.registrations)
    .map((r) => (r.label ? `${r.label} ${r.number}` : r.number));

  return el('div.rcpt.rcpt-tax', { 'aria-label': `Tax summary for ${period}` },
    el('div.rcpt-head', {},
      el('div.rcpt-store', {}, s.storeName || 'Point of Sale'),
      s.address && el('div.rcpt-addr', {}, s.address),
      // A filing document without the registration number it is filed under
      // is not much use to a bookkeeper. Sanitized the way the receipt path
      // does it, so the two documents a shop hands out can't state the
      // registration differently.
      registrations.length
        ? el('div.rcpt-reg', {}, registrations.map((line) => el('div', {}, line)))
        : null
    ),
    el('div.rcpt-kind.rcpt-kind-z', {}, 'TAX SUMMARY'),
    el('div.rcpt-meta', {},
      el('span', {}, period),
      el('span', {}, summary.inclusive
        ? `Prices include tax · ${s.currency}`
        : `Tax added at sale · ${s.currency}`)
    ),

    /* One block per rate, so a row's base and tax can't be read off the
       wrong line the way a three-column table on 58mm paper invites. */
    ...summary.rows.map((r) => el('div.rcpt-totals', {},
      el('div.rcpt-section', {}, taxRowLabel(r)),
      row('Taxable', money(r.base)),
      row('Tax', money(r.tax)),
      row('Gross', money(r.gross))
    )),
    !summary.rows.length ? el('div.rcpt-totals', {}, row('No sales in this period', money(0))) : null,

    el('div.rcpt-totals', {},
      el('div.rcpt-section', {}, 'Total'),
      row('Taxable', money(summary.base)),
      row('Tax collected', money(summary.tax), '.rcpt-total'),
      row('Gross taken', money(summary.gross))
    ),
    summary.mixed
      ? el('div.rcpt-note', {},
        'Tax-inclusive pricing changed during this period; each sale is counted as it was rung up.')
      : null,
    el('div.rcpt-footer', {}, 'Net of refunds · voided sales excluded')
  );
}

export function printTaxDoc(summary, period, store) {
  printDocument(taxDocNode(summary, period, store));
}
