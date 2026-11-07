/**
 * The Z-report: one day's takings and its cash reconciliation, as a till slip.
 *
 * One model, three copies - the on-screen slip, the browser print, and the
 * bytes a thermal printer takes - so a signed-off day can't read differently
 * on paper than it does on the tablet.
 *
 * Everything comes from the snapshot taken at close time, so a later refund
 * can't rewrite a report that has already been signed off.
 */

import { el } from './dom.js';
import { toast } from './toast.js';
import { formatMoney } from '../lib/money.js';
import { formatDayFull, formatTime } from '../lib/dates.js';
import { paymentMethodInfo } from '../lib/payments.js';
import { overShortLabel } from '../lib/drawer.js';
import { printDocument } from './receipt.js';
import { hasPrinter, printReportBytes, printerSaid } from '../lib/printer.js';
import { plural } from '../lib/util.js';

/**
 * zReportModel(day, store) - the day close as sections of label/value rows.
 *
 * `day` is a drawer record with a `close` (a closed day).
 */
export function zReportModel(day, store) {
  const close = day.close;
  const cur = close.currency || store.settings.currency;
  const money = (n) => formatMoney(n, cur);
  const s = store.settings;
  const diff = close.diff || 0;
  const row = (label, value, extra = {}) => ({ label, value, ...extra });

  const sections = [
    {
      rows: [
        row('Sales', String(close.salesCount)),
        close.refundCount > 0 && row('Refunds', String(close.refundCount)),
        row('Revenue', money(close.revenue)),
        row('Tax collected', money(close.tax)),
        row('Discounts given', money(close.discounts)),
      ].filter(Boolean),
    },
    {
      title: 'Takings',
      rows: [
        ...(close.byMethod || []).map((m) => row(
          `${paymentMethodInfo(m.method).label} · ${plural(m.count, 'tender')}`, money(m.amount),
        )),
        !(close.byMethod || []).length && row('No takings', money(0)),
        // Gratuities, apart from takings: revenue and the terminal batch
        // (amount + tip) both still reconcile against this slip.
        ...(close.tips || []).map((t) => row(
          `Tips · ${paymentMethodInfo(t.method).label.toLowerCase()}`, money(t.amount),
        )),
      ].filter(Boolean),
    },
    {
      title: 'Cash drawer',
      rows: [
        row('Opening float', money(close.float)),
        row('Cash sales', money(close.cashSales)),
        close.cashTips > 0 && row('Cash tips', money(close.cashTips)),
        close.cashRefunds > 0 && row('Cash refunds', `−${money(close.cashRefunds)}`),
        close.paidIn > 0 && row('Paid in', money(close.paidIn)),
        close.paidOut > 0 && row('Paid out', `−${money(close.paidOut)}`),
        row('Expected', money(close.expected), { strong: true }),
        row('Counted', money(close.counted)),
        // Label and figure, not the label twice: "Short" / "$2.00".
        row(diff === 0 ? 'Balanced' : diff > 0 ? 'Over' : 'Short', money(Math.abs(diff)), {
          strong: true,
          tone: diff === 0 ? '' : diff > 0 ? 'over' : 'short',
        }),
      ].filter(Boolean),
    },
  ];

  /* Every movement, so the figures above can be checked line by line. */
  const movements = (day.movements || []).map((m) => ({
    time: formatTime(m.at),
    reason: m.reason || (m.amount > 0 ? 'Paid in' : 'Paid out'),
    // A drawer opened for no sale moved no money; a signed zero would read
    // as one, so it says what it was instead.
    amount: m.amount === 0 ? '—' : money(m.amount),
  }));

  return {
    head: {
      storeName: s.storeName || 'Point of Sale',
      address: s.address || '',
      kind: 'Z-REPORT',
      meta: [
        formatDayFull(day.date),
        `Closed ${formatTime(close.at)}${day.openedAt ? ` · opened ${formatTime(day.openedAt)}` : ''}`,
      ],
      footer: 'Z-report · counted and closed',
    },
    sections,
    movements,
    overShort: overShortLabel(diff, money),
  };
}

const domRow = (r) => el(`div.rcpt-row${r.strong ? '.rcpt-total' : ''}${r.tone === 'over' ? '.rcpt-over' : r.tone === 'short' ? '.rcpt-short' : ''}`, {},
  el('span', {}, r.label), el('span', {}, r.value));

/** The slip as the screen and the browser's print dialog show it. */
export function zReportNode(day, store) {
  const model = zReportModel(day, store);
  return el('div.rcpt.rcpt-z', { 'aria-label': `Z-report for ${day.date}` },
    el('div.rcpt-head', {},
      el('div.rcpt-store', {}, model.head.storeName),
      model.head.address && el('div.rcpt-addr', {}, model.head.address)
    ),
    el('div.rcpt-kind.rcpt-kind-z', {}, model.head.kind),
    el('div.rcpt-meta', {}, model.head.meta.map((line) => el('span', {}, line))),
    ...model.sections.map((section) => el('div.rcpt-totals', {},
      section.title && el('div.rcpt-section', {}, section.title),
      ...section.rows.map(domRow))),
    model.movements.length ? el('div.rcpt-lines', {},
      el('div.rcpt-section', {}, 'Cash movements'),
      ...model.movements.map((m) => el('div.rcpt-line', {},
        el('div.rcpt-line-main', {},
          el('span.rcpt-qty', {}, m.time),
          el('span.rcpt-name', {}, m.reason),
          el('span.rcpt-amount', {}, m.amount)
        )
      ))
    ) : null,
    el('div.rcpt-footer', {}, model.head.footer)
  );
}

/**
 * Put the Z-report on paper: straight to the thermal printer where this
 * device has one, and through the browser's print dialog otherwise - or
 * whenever the printer doesn't answer.
 */
export async function printZReport(day, store) {
  const model = zReportModel(day, store);
  if (hasPrinter()) {
    const rows = [];
    for (const section of model.sections) {
      if (section.title) rows.push({ section: section.title });
      rows.push(...section.rows);
    }
    if (model.movements.length) {
      rows.push({ section: 'Cash movements' });
      for (const m of model.movements) rows.push({ label: `${m.time} ${m.reason}`, value: m.amount });
    }
    try {
      await printReportBytes(model.head, rows);
      return true;
    } catch (err) {
      console.error(err);
      toast(`${printerSaid(err)} — using the print dialog instead`,
        { icon: 'alert', duration: 6000 });
    }
  }
  printDocument(zReportNode(day, store));
  return false;
}
