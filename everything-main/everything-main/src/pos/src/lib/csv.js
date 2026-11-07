/**
 * CSV export of sales history, for the spreadsheet an accountant actually
 * works in.
 *
 * Three shapes, because they answer different questions:
 *   receiptsCsv    - one row per sale ("what did we take in July?")
 *   lineItemsCsv   - one row per line ("how much flat white did we sell?")
 *   taxSummaryCsv  - one row per rate ("what goes on the return?")
 *
 * Conventions: RFC-4180 quoting, CRLF rows, ISO dates, amounts as plain
 * decimals with a separate currency column (never a symbol inside a number),
 * and a UTF-8 BOM so Excel opens accented names correctly.
 *
 * Voided sales are included and marked - reports exclude them, but an
 * accounting extract that silently drops rows is worse than useless. The
 * Status column is how a spreadsheet filters them back out.
 */

import {
  PAYMENT_METHODS, paymentMethodInfo, paymentKindOf, receiptPayments, receiptChange, receiptTip,
} from './payments.js';
import { optionsLabel } from './options.js';
import { isRefund } from './refunds.js';
import { hasLineCost, lineCost, lineProfit } from './profit.js';

/** Byte-order mark: without it Excel reads UTF-8 CSV as the local codepage. */
export const CSV_BOM = '\uFEFF';

/**
 * Cells a spreadsheet would run instead of read.
 *
 * Excel, Sheets and LibreOffice treat a value starting with =, +, - or @ as a
 * formula, so a product name, a note or an option typed at the register could
 * become =HYPERLINK(...) or a DDE call in the bookkeeper's spreadsheet - the
 * register's own data, opened somewhere it has authority. Anything that looks
 * like a formula is prefixed with an apostrophe, which marks the cell as text.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A plain number must stay a number: a refund's -32.00 has to still sum. */
const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/;

/**
 * One CSV field. Quoted when it contains a delimiter, quote, newline, or
 * edge whitespace that a spreadsheet would otherwise eat; inner quotes are
 * doubled per RFC-4180.
 */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  if (!/[",\r\n]/.test(s) && s === s.trim()) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Rows of arrays → a CSV document (CRLF, trailing newline). */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** A downloadable CSV blob, BOM included. */
export function csvBlob(text) {
  return new Blob([CSV_BOM + text], { type: 'text/csv;charset=utf-8' });
}

/** Plain decimal for money columns - no symbol, no thousands separator. */
const amount = (n) => (Number(n) || 0).toFixed(2);

/** Local 24-hour clock time of a timestamp, for the Time column. */
function isoTime(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const statusOf = (sale) => (sale.voidedAt ? 'Voided' : 'Completed');

/** Oldest first: a ledger reads forwards, unlike the receipts list. */
function chronological(sales) {
  return [...sales].sort((a, b) => (a.at || 0) - (b.at || 0) || (a.number || 0) - (b.number || 0));
}

/**
 * The distinct tax rates charged across these receipts, each becoming its
 * own column so a filing can total by rate. Keyed on name+rate the same way
 * computeCart buckets them.
 */
export function taxColumns(sales) {
  const cols = new Map();
  for (const sale of sales) {
    for (const t of sale.taxes || []) {
      const name = t.name || 'Tax';
      const key = `${name}|${t.rate}`;
      if (!cols.has(key)) cols.set(key, { key, name, rate: t.rate, label: `Tax: ${name} ${t.rate}%` });
    }
  }
  return [...cols.values()].sort((a, b) => a.name.localeCompare(b.name) || a.rate - b.rate);
}

/** One row per receipt. */
export function receiptsCsv(sales) {
  const list = chronological(sales);
  const taxCols = taxColumns(list);
  const rows = [[
    'Receipt', 'Date', 'Time', 'Type', 'Refund of', 'Status', 'Items', 'Currency',
    'Subtotal', 'Discounts', 'Tax',
    ...taxCols.map((c) => c.label),
    'Total', 'Payment',
    // Per-method amounts, so a split sale still reconciles against the till.
    ...PAYMENT_METHODS.map((m) => `Paid ${m.label.toLowerCase()}`),
    // Tips ride on payments and are excluded from every money column above.
    'Tip', 'Change', 'Customer', 'Note',
  ]];

  for (const s of list) {
    const byKey = new Map((s.taxes || []).map((t) => [`${t.name || 'Tax'}|${t.rate}`, t]));
    const tenders = receiptPayments(s);
    const paid = new Map(PAYMENT_METHODS.map((m) => [m.value, 0]));
    for (const t of tenders) {
      paid.set(t.method, (paid.get(t.method) || 0) + (Number(t.amount) || 0));
    }
    rows.push([
      s.number,
      s.date,
      isoTime(s.at),
      isRefund(s) ? 'Refund' : 'Sale',
      isRefund(s) && s.refundOfNumber !== undefined ? s.refundOfNumber : '',
      statusOf(s),
      s.itemCount,
      s.currency || '',
      amount(s.subtotal),
      amount(s.discountTotal),
      amount(s.taxTotal),
      ...taxCols.map((c) => amount(byKey.get(c.key)?.tax || 0)),
      amount(s.total),
      paymentMethodInfo(paymentKindOf(s)).label,
      ...PAYMENT_METHODS.map((m) => amount(paid.get(m.value))),
      amount(receiptTip(s)),
      amount(receiptChange(s)),
      s.customerName || '',
      s.note || '',
    ]);
  }
  return toCsv(rows);
}

/**
 * One row per sold line. `catalog` resolves SKU and category for lines whose
 * product still exists; deleted products and custom items fall back to the
 * name the receipt snapshotted.
 */
export function lineItemsCsv(sales, catalog = null) {
  const rows = [[
    'Receipt', 'Date', 'Time', 'Type', 'Status', 'Product', 'Options', 'Note', 'SKU', 'Category',
    // Unit names the measure of a decimal quantity ('kg'); empty = whole units.
    'Quantity', 'Unit', 'Unit price', 'Line discount', 'Tax rate %', 'Tax', 'Line total',
    // Cost is optional per line: empty means the sale recorded none, which is
    // not the same as zero and must not sum as if it were.
    'Unit cost', 'Line cost', 'Gross profit', 'Currency',
  ]];

  for (const s of chronological(sales)) {
    const time = isoTime(s.at);
    const status = statusOf(s);
    const type = isRefund(s) ? 'Refund' : 'Sale';
    for (const l of s.lines || []) {
      const product = l.productId && catalog ? catalog.product(l.productId) : null;
      let category;
      if (!l.productId) category = 'Custom item';
      else if (!product) category = '—';                       // product since deleted
      else category = catalog.category(product.categoryId)?.name || 'Uncategorized';

      rows.push([
        s.number,
        s.date,
        time,
        type,
        status,
        l.name,
        // Its own column, so "how much flat white" still groups by product.
        optionsLabel(l.options),
        l.note || '',
        product?.sku || '',
        category,
        l.qty,
        l.unit || '',
        amount(l.unitPrice),
        amount(l.discountAmount),
        Number(l.taxRate) || 0,
        amount(l.tax),
        amount(l.total),
        hasLineCost(l) ? amount(l.unitCost) : '',
        hasLineCost(l) ? amount(lineCost(l)) : '',
        hasLineCost(l) ? amount(lineProfit(l)) : '',
        s.currency || '',
      ]);
    }
  }
  return toCsv(rows);
}

/**
 * The tax summary as its own small extract: one row per rate, the unrated
 * buckets, and a total line - what a bookkeeper is handed for a filing.
 * `summary` comes from lib/tax-report.js.
 */
export function taxSummaryCsv(summary, { from, to, currency = '', storeName = '' } = {}) {
  const rows = [
    ['Tax summary', storeName || ''],
    ['From', from || ''],
    ['To', to || ''],
    ['Currency', currency],
    [],
    ['Rate name', 'Rate %', 'Taxable base', 'Tax collected', 'Gross'],
  ];
  for (const row of summary.rows) {
    rows.push([
      row.kind === 'free' ? 'Tax-free' : row.name,
      // A tax-free row has no rate at all; a zero-rated one has a rate of 0.
      row.kind === 'free' ? '' : row.rate,
      amount(row.base),
      amount(row.tax),
      amount(row.gross),
    ]);
  }
  rows.push([], ['Total', '', amount(summary.base), amount(summary.tax), amount(summary.gross)]);
  return toCsv(rows);
}

/** `sales-2026-08-01_2026-08-31.csv` */
export function csvFilename(prefix, fromISO, toISO) {
  return `${prefix}-${fromISO}_${toISO}.csv`;
}
