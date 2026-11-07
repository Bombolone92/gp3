/**
 * One description of a receipt, used by every way of presenting one.
 *
 * The on-screen document, the printed page, and the shareable image all render
 * this model, so a customer's copy can never say something different from the
 * paper slip - the amounts are formatted here, once.
 */

import { formatMoney } from './money.js';
import { round2 } from './util.js';
import { formatDayFull, formatTime } from './dates.js';
import { optionsLabel } from './options.js';
import { receiptPayments, receiptChange, receiptTip, paymentMethodInfo } from './payments.js';
import { isRefund } from './refunds.js';
import { progressText } from './loyalty.js';

/**
 * A line's quantity as the slip prints it: '2×', '0.735 kg', and on a refund
 * the same with a minus in front. The sign is written out rather than left to
 * the number, so it is the app's own minus (U+2212) - the amount beside it on
 * that very line already is, and a slip carrying both marks a column apart
 * reads as two different kinds of negative.
 */
function qtyText(line) {
  const sign = line.qty < 0 ? '−' : '';
  const amount = Math.abs(line.qty);
  return line.unit ? `${sign}${amount} ${line.unit}` : `${sign}${amount}×`;
}

/**
 * receiptDoc(receipt, settings) → a flat, presentation-ready description.
 *
 * `settings` supplies the store's own details (name, address, footer), which
 * are current rather than snapshotted - a shop that moves wants its new
 * address on a reprint.
 */
export function receiptDoc(receipt, settings = {}) {
  const money = (n) => formatMoney(n, receipt.currency);
  const refund = isRefund(receipt);

  // The receipt's own snapshot when it has one (taken at sale time, so a
  // later edit can't rewrite an issued document); receipts that predate the
  // feature fall back to the store's current numbers, like the address does.
  const registrations = (receipt.registrations ?? settings.registrations ?? [])
    .map((r) => ({ label: String(r?.label || '').trim(), number: String(r?.number || '').trim() }))
    .filter((r) => r.number)   // a label with no number is nothing to print
    .map((r) => (r.label ? `${r.label} ${r.number}` : r.number))
    .slice(0, 2);

  const meta = [`${refund ? 'Refund' : 'Receipt'} #${receipt.number}`];
  if (refund && receipt.refundOfNumber !== undefined) {
    meta.push(`for receipt #${receipt.refundOfNumber}${receipt.refundOfDate ? ` · ${formatDayFull(receipt.refundOfDate)}` : ''}`);
  }
  meta.push(`${formatDayFull(receipt.date)} · ${formatTime(receipt.at)}`);
  // The snapshotted name, never a directory lookup: history must read the
  // same after the customer is renamed or deleted.
  if (receipt.customerName) meta.push(`For ${receipt.customerName}`);

  const items = (receipt.lines || []).map((l) => {
    const subs = [];
    if (l.options?.length) subs.push({ text: optionsLabel(l.options), kind: 'options' });
    // A measured line always names its per-unit price ('$12.00/kg') - the
    // quantity alone doesn't say what was charged the way '2×' does.
    if (l.unit) subs.push({ text: `${money(l.unitPrice)}/${l.unit}`, kind: 'unit' });
    else if (Math.abs(l.qty) > 1) subs.push({ text: `${money(l.unitPrice)} each`, kind: 'unit' });
    if (l.discountAmount) {
      subs.push({
        text: refund ? `Discount ${money(l.discountAmount)}` : `Discount −${money(l.discountAmount)}`,
        kind: 'discount',
      });
    }
    // Last, under the price and the discount: it is the instruction the line
    // was made to, and on a cafe slip that is what the customer checks.
    if (l.note) subs.push({ text: l.note, kind: 'note' });
    return { qty: qtyText(l), name: l.name, amount: money(l.subtotal), subs };
  });

  const totals = [{ label: 'Subtotal', value: money(receipt.subtotal) }];
  if (receipt.discountTotal) {
    totals.push({
      label: 'Discounts',
      value: refund ? money(receipt.discountTotal) : `−${money(receipt.discountTotal)}`,
    });
  }
  for (const t of receipt.taxes || []) {
    totals.push({
      label: `${t.name || 'Tax'} ${t.rate}%${receipt.pricesIncludeTax ? ' (included)' : ''}`,
      value: money(t.tax),
    });
  }
  totals.push({ label: 'Total', value: money(receipt.total), strong: true });

  // A gratuity is its own labelled line, never folded into the sale's
  // totals; each tender then shows what actually moved on it - cash shows
  // the notes handed over, a tipped card shows what the terminal charged.
  const tip = receiptTip(receipt);
  const change = receiptChange(receipt);
  const payments = [];
  if (tip > 0) payments.push({ label: 'Tip', value: money(tip) });
  for (const t of receiptPayments(receipt)) {
    // Money going onto a balance is not money going back over the counter:
    // the balance *rises*, so the row says what it says and carries what the
    // customer gained, not the sale's own negative.
    const issued = refund && t.method === 'credit';
    payments.push({
      label: issued ? 'Store credit issued' : `${paymentMethodInfo(t.method).label}${refund ? ' refunded' : ''}`,
      value: money(issued
        ? Math.abs(Number(t.amount) || 0)
        : t.tendered ?? round2((Number(t.amount) || 0) + Math.max(0, Number(t.tip) || 0))),
    });
  }
  if (change > 0) payments.push({ label: 'Change', value: money(change) });
  // The balance is what a customer keeps this copy for - proof that the money
  // stayed in the shop, and of how much of it is theirs to spend. Snapshotted
  // at the time, so a reprint says what the slip said.
  if (receipt.creditBalance !== undefined && receipt.creditBalance !== null) {
    payments.push({ label: 'Store credit balance', value: money(receipt.creditBalance), strong: true });
  }

  return {
    number: receipt.number,
    refund,
    voided: !!receipt.voidedAt,
    kind: refund ? 'REFUND' : null,
    storeName: settings.storeName || 'Point of Sale',
    address: settings.address || '',
    // Current, not snapshotted: inline images would bloat every month file,
    // and a reprint wearing the store's current mark is what a reprint is.
    logo: settings.logo || null,
    registrations,
    meta,
    items,
    totals,
    payments,
    note: receipt.note || '',
    // The punch card, in words: '8 of 10 toward a free coffee'. Read from the
    // figures the sale snapshotted, so a reprint says what the card stood at
    // then - this line is the reminder the cardboard card used to be.
    loyalty: receipt.loyalty && !refund ? progressText(receipt.loyalty, money) : '',
    reward: receipt.reward ? `${receipt.reward.name} · −${money(receipt.reward.value)}` : '',
    footer: settings.receiptFooter || '',
  };
}
