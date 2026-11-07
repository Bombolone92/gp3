/**
 * "Export CSV" sheet, shared by Reports (prefilled with the range on screen)
 * and Settings (any range at all). One dialog, two files: the range is picked
 * once and both extracts come from the same loaded receipts.
 */

import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { downloadBlob } from './download.js';
import { store } from '../lib/store.js';
import { receiptsCsv, lineItemsCsv, csvBlob, csvFilename } from '../lib/csv.js';
import { todayISO, formatDay } from '../lib/dates.js';
import { plural } from '../lib/util.js';

export function openCsvExport({ from = todayISO(), to = todayISO() } = {}) {
  let fromISO = from;
  let toISO = to;
  /** Receipts for the range currently in the inputs, or null while unknown. */
  let loaded = null;
  let loadToken = 0;

  const fromInput = el('input.input', { type: 'date', value: fromISO, max: '2999-12-31', 'aria-label': 'From date' });
  const toInput = el('input.input', { type: 'date', value: toISO, max: '2999-12-31', 'aria-label': 'To date' });
  const summary = el('div.export-summary', { 'aria-live': 'polite' });
  const actions = el('div.export-actions');

  const invalid = () => !fromISO || !toISO || fromISO > toISO;

  async function load() {
    const token = ++loadToken;
    loaded = null;
    renderActions();
    if (invalid()) {
      clear(summary);
      summary.append(el('span.export-warn', {}, !fromISO || !toISO
        ? 'Pick a start and an end date.'
        : 'The start date is after the end date.'));
      return;
    }
    clear(summary);
    summary.append(el('span.muted', {}, 'Counting sales…'));
    let sales;
    try {
      sales = await store.salesInRange(fromISO, toISO);
    } catch (err) {
      console.error(err);
      if (token !== loadToken) return;
      clear(summary);
      summary.append(el('span.export-warn', {}, 'Couldn’t read your sales. Check your connection.'));
      return;
    }
    if (token !== loadToken) return;   // a newer range is already loading
    loaded = sales;
    const voided = sales.filter((s) => s.voidedAt).length;
    const lines = sales.reduce((a, s) => a + (s.lines?.length || 0), 0);
    clear(summary);
    summary.append(sales.length
      ? el('span', {},
        el('strong', {}, plural(sales.length, 'receipt')),
        ` · ${plural(lines, 'line item')}`,
        voided ? ` · ${voided} voided (marked, not dropped)` : '')
      : el('span.muted', {}, 'No sales in this range.'));
    renderActions();
  }

  const commit = () => {
    fromISO = fromInput.value;
    toISO = toInput.value;
    load();
  };
  fromInput.addEventListener('change', commit);
  toInput.addEventListener('change', commit);

  function download(kind) {
    const sales = loaded;
    if (!sales?.length) return;
    const isReceipts = kind === 'receipts';
    const text = isReceipts ? receiptsCsv(sales) : lineItemsCsv(sales, store);
    downloadBlob(csvBlob(text), csvFilename(isReceipts ? 'sales' : 'sale-items', fromISO, toISO));
    toast(`${isReceipts ? 'Receipts' : 'Line items'} CSV downloaded`, { icon: 'fileSheet' });
  }

  function renderActions() {
    clear(actions);
    const ready = !!loaded?.length;
    const option = (kind, title, sub, primary) => el('button.export-opt', {
      type: 'button',
      className: `export-opt${primary ? ' primary' : ''}`,
      disabled: !ready,
      onclick: () => download(kind),
    },
      el('span.export-opt-ic', { html: icon('fileSheet', 18, 1.8) }),
      el('span.export-opt-text', {},
        el('span.export-opt-title', {}, title),
        el('span.export-opt-sub', {}, sub)),
      el('span.export-opt-go', { html: icon('fileDown', 16, 2) })
    );
    actions.append(
      option('receipts', 'Receipts', 'One row per sale: totals, tax by rate, payment', true),
      option('lines', 'Line items', 'One row per product sold: quantity, price, tax', false)
    );
  }

  const body = el('div', {},
    el('p.small.muted', { style: { marginBottom: '14px' } },
      'Spreadsheet-ready files for a bookkeeper: ISO dates, plain decimal amounts, and a currency column.'),
    el('div.form-grid', {},
      el('div.field', {}, el('label.label', {}, 'From'), fromInput),
      el('div.field', {}, el('label.label', {}, 'To'), toInput)
    ),
    el('div.chip-row', {}, [
      ['Today', () => [todayISO(), todayISO()]],
      ['This month', () => [`${todayISO().slice(0, 7)}-01`, todayISO()]],
      ['Last month', () => {
        const d = new Date();
        const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        const end = new Date(d.getFullYear(), d.getMonth(), 0);
        return [todayISO(start), todayISO(end)];
      }],
      ['This year', () => [`${new Date().getFullYear()}-01-01`, todayISO()]],
    ].map(([label, range]) => el('button.chip', {
      type: 'button',
      onclick: () => {
        const [f, t] = range();
        fromInput.value = f;
        toInput.value = t;
        commit();
      },
    }, label))),
    summary,
    actions
  );

  openModal({ title: 'Export CSV', content: body });
  load();
}

/** 'Aug 1 – Aug 31' for a button hint. */
export function rangeLabel(fromISO, toISO) {
  return fromISO === toISO ? formatDay(fromISO) : `${formatDay(fromISO)} – ${formatDay(toISO)}`;
}
