/**
 * Report aggregation: the two numbers every freelancer needs at tax time
 * ("what did I earn this period?", "how much tax did I collect?") plus where
 * the money came from.
 *
 * Pure functions over documents, like money.js and dates.js, because these
 * are the figures a tax return is built on and they deserve tests rather
 * than a view that adds up as it renders.
 *
 * Two views of the same money, never mixed:
 *   invoiced  — accrual: totals of invoices issued inside the period
 *   collected — cash: payments actually received inside the period
 *
 * Tax collected prorates each document's tax by the share of its total that
 * was paid, so a half-paid invoice contributes half its tax. Amounts are
 * always kept per currency: adding dollars to euros would be a lie.
 */

import { round2 } from './util.js';
import { docTotals, fxRateFor, paymentFxRate, inBase } from './money.js';
import { isWrittenOff } from './doc.js';
import { toISO, daysInMonth, yearOf } from './dates.js';
import { csvEscape } from './acct-csv.js';
import { aging, agingCsvRows } from './aging.js';

export const PERIOD_KINDS = [
  { value: 'year', label: 'Year' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'month', label: 'Month' },
];

const monthName = (year, month1, style = 'long') => {
  try {
    return new Intl.DateTimeFormat(undefined, { month: style }).format(new Date(year, month1 - 1, 1));
  } catch {
    return `Month ${month1}`;
  }
};

const pad2 = (n) => String(n).padStart(2, '0');

/** A period is { kind: 'year'|'quarter'|'month', year, index }. */
export function periodRange({ kind, year, index = 1 } = {}) {
  const y = Number(year) || Number(yearOf(toISO(new Date())));
  if (kind === 'month') {
    const m = Math.min(12, Math.max(1, Number(index) || 1));
    return { start: `${y}-${pad2(m)}-01`, end: `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}` };
  }
  if (kind === 'quarter') {
    const q = Math.min(4, Math.max(1, Number(index) || 1));
    const first = q * 3 - 2;
    const last = q * 3;
    return { start: `${y}-${pad2(first)}-01`, end: `${y}-${pad2(last)}-${pad2(daysInMonth(y, last))}` };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function periodLabel({ kind, year, index = 1 } = {}) {
  if (kind === 'month') return `${monthName(year, Number(index) || 1)} ${year}`;
  if (kind === 'quarter') return `Q${Number(index) || 1} ${year}`;
  return String(year);
}

/**
 * The months a period breaks down into: the shape of "income over time".
 * A month-long period has a single bucket, and the view skips the breakdown.
 */
export function subPeriods({ kind, year, index = 1 } = {}) {
  const y = Number(year);
  const months = kind === 'month'
    ? [Number(index) || 1]
    : kind === 'quarter'
      ? [index * 3 - 2, index * 3 - 1, index * 3]
      : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return months.map((m) => ({
    key: `${y}-${pad2(m)}`,
    label: monthName(y, m, 'short'),
    ...periodRange({ kind: 'month', year: y, index: m }),
  }));
}

/** Years that have any document or payment, newest first. */
export function reportYears(docs, today) {
  const years = new Set();
  for (const doc of docs || []) {
    if (doc.issueDate) years.add(yearOf(doc.issueDate));
    for (const p of doc.payments || []) if (p.date) years.add(yearOf(p.date));
  }
  if (today) years.add(yearOf(today));
  return [...years].filter((y) => /^\d{4}$/.test(y)).sort().reverse();
}

const inRange = (iso, start, end) => !!iso && iso >= start && iso <= end;

const bump = (map, currency, patch) => {
  const row = map[currency] || (map[currency] = {
    invoiced: 0, collected: 0, taxInvoiced: 0, taxCollected: 0, open: 0,
    writtenOff: 0, invoiceCount: 0, paymentCount: 0, taxByLabel: {},
  });
  for (const [k, v] of Object.entries(patch)) row[k] += v;
  return row;
};

const roundRows = (map) => {
  for (const row of Object.values(map)) {
    for (const key of ['invoiced', 'collected', 'taxInvoiced', 'taxCollected', 'open', 'writtenOff']) {
      row[key] = round2(row[key]);
    }
    for (const key of Object.keys(row.taxByLabel)) {
      row.taxByLabel[key] = round2(row.taxByLabel[key]);
    }
  }
  return map;
};

/**
 * reportFor(docs, clients, period) -> {
 *   period, label, start, end,
 *   currencies: [code, ...]                     // busiest first
 *   totals:  { USD: { invoiced, collected, taxInvoiced, taxCollected, open, counts } },
 *   series:  { USD: [{ key, label, invoiced, collected, taxCollected }] },
 *   clients: { USD: [{ id, name, invoiced, collected, open }] },
 * }
 *
 * Void invoices count for nothing, and estimates are not income: only
 * invoices and their payments are aggregated. A written-off invoice was
 * genuinely billed, so it stays in `invoiced` and reports what it gave up in
 * `writtenOff`, but it leaves `open` — nobody is chasing it. A draft has not been issued to
 * anyone, so it is neither invoiced nor owed — exactly how clientTotals()
 * and the dashboard read one. Money already recorded against a draft still
 * counts as collected, because it did arrive.
 */
export function reportFor(docs, clients, period, { baseCurrency = '' } = {}) {
  const { start, end } = periodRange(period);
  const buckets = subPeriods(period);
  // Keyed by currency, which is free text on an imported document: null
  // prototypes, so a currency named like an Object.prototype member gets a
  // row of its own instead of "finding" (and writing onto) the prototype.
  const totals = Object.create(null);
  const series = Object.create(null);
  const byClient = new Map();
  const clientName = new Map((clients || []).map((c) => [c.id, c.company || c.name]));

  const seriesRow = (currency, key) => {
    const list = series[currency] || (series[currency] = buckets.map((b) => ({
      key: b.key, label: b.label, invoiced: 0, collected: 0, taxCollected: 0,
    })));
    return list.find((row) => row.key === key);
  };

  // The consolidated view: every figure above, converted into the user's own
  // money at the rate stored on each document. Absent unless a base currency
  // was asked for. `missing` counts what had to be left out, because a
  // consolidated total that quietly drops a document is worse than no total.
  const base = baseCurrency
    ? {
      currency: baseCurrency,
      invoiced: 0,
      collected: 0,
      taxCollected: 0,
      open: 0,
      foreign: false,          // is there anything here that needed a rate?
      missingInvoiced: 0,
      missingCollected: 0,
      missingOpen: 0,
    }
    : null;

  const clientRow = (currency, id) => {
    const key = `${currency}|${id}`;
    let row = byClient.get(key);
    if (!row) {
      row = {
        id,
        currency,
        name: clientName.get(id) || 'No client',
        invoiced: 0,
        collected: 0,
        open: 0,
      };
      byClient.set(key, row);
    }
    return row;
  };

  for (const doc of docs || []) {
    if (doc.kind !== 'invoice' || doc.status === 'void') continue;
    const currency = doc.currency || 'USD';
    const t = docTotals(doc);
    const taxShare = t.total > 0 ? t.tax / t.total : 0;
    // Each named tax prorates by payment exactly like the sum does, so a
    // half-paid GST+PST invoice contributes half of each.
    const labelShares = t.total > 0
      ? t.taxes.map((x) => [`${x.label || 'Tax'} (${x.rate}%)`, x.amount / t.total, x.amount])
      : [];
    const cid = doc.clientId || '';
    const issued = doc.status !== 'draft';

    const written = isWrittenOff(doc);
    const rate = base ? fxRateFor(doc, base.currency) : null;
    // The block is only worth showing when something in this period actually
    // needed converting: a draft in another currency has not been billed to
    // anyone, and a consolidated total that merely restates the table above
    // it is noise.
    const markForeign = () => {
      if (base && currency !== base.currency) base.foreign = true;
    };

    if (issued && inRange(doc.issueDate, start, end)) {
      bump(totals, currency, { invoiced: t.total, taxInvoiced: t.tax, invoiceCount: 1 });
      clientRow(currency, cid).invoiced += t.total;
      const bucket = seriesRow(currency, doc.issueDate.slice(0, 7));
      if (bucket) bucket.invoiced += t.total;
      // What was billed in this period and given up on: measured against the
      // same slice as `invoiced`, because that is the question it answers —
      // of what I billed, how much will never arrive. Only the unpaid part
      // counts, so money that came in after the write-off shrinks it, and an
      // invoice paid in full after all contributes nothing.
      if (written) bump(totals, currency, { writtenOff: Math.max(0, t.balance) });
      if (base) {
        markForeign();
        if (rate === null) base.missingInvoiced++;
        else base.invoiced += inBase(t.total, rate);
      }
    }

    // Open balance is what the client still owes today on anything issued up
    // to the end of the period — the number you would chase, not a
    // reconstruction of history. A written-off invoice is no longer chased,
    // and neither is an overpaid one: a negative balance is a credit the user
    // owes back (recorded as a refund), not a receivable, and counting it
    // here made this figure disagree with the aging table under it, with the
    // client's own page, and with the Outstanding tile on Home — all three of
    // which read openness through isOpenInvoice().
    if (issued && !written && doc.issueDate && doc.issueDate <= end && t.balance > 0.005) {
      bump(totals, currency, { open: t.balance });
      clientRow(currency, cid).open += t.balance;
      if (base) {
        markForeign();
        if (rate === null) base.missingOpen++;
        else base.open += inBase(t.balance, rate);
      }
    }

    // Payments prorate in date order so the running prorated tax can be
    // capped at what the invoice actually charges: an overpayment collects
    // more cash, never more tax than the invoice carries. Each payment
    // takes its slice of the capped running figure; the slices telescope,
    // so overpaid-then-refunded histories still sum to the true amount.
    const paymentsInOrder = [...(doc.payments || [])].sort((a, b) => ((a?.date || '') < (b?.date || '') ? -1
      : (a?.date || '') > (b?.date || '') ? 1 : (a?.createdAt || 0) - (b?.createdAt || 0)));
    let cumPaid = 0;
    for (const p of paymentsInOrder) {
      const amount = Number(p?.amount) || 0;
      const prevPaid = cumPaid;
      cumPaid += amount;
      if (!inRange(p?.date, start, end)) continue;
      const slice = (share, cap) => Math.min(cumPaid * share, cap) - Math.min(prevPaid * share, cap);
      const tax = slice(taxShare, t.tax);
      const row = bump(totals, currency, { collected: amount, taxCollected: tax, paymentCount: 1 });
      for (const [label, share, cap] of labelShares) {
        row.taxByLabel[label] = (row.taxByLabel[label] || 0) + slice(share, cap);
      }
      clientRow(currency, cid).collected += amount;
      const bucket = seriesRow(currency, p.date.slice(0, 7));
      if (bucket) { bucket.collected += amount; bucket.taxCollected += tax; }
      if (base) {
        markForeign();
        // Money received months later converted at a different rate, so a
        // payment may carry its own; the document's is the fallback.
        const paidRate = paymentFxRate(p, doc, base.currency);
        if (paidRate === null) base.missingCollected++;
        else {
          base.collected += inBase(amount, paidRate);
          base.taxCollected += inBase(tax, paidRate);
        }
      }
    }
  }

  roundRows(totals);
  for (const list of Object.values(series)) {
    for (const row of list) {
      row.invoiced = round2(row.invoiced);
      row.collected = round2(row.collected);
      row.taxCollected = round2(row.taxCollected);
    }
  }

  const clientRows = Object.create(null);
  for (const row of byClient.values()) {
    row.invoiced = round2(row.invoiced);
    row.collected = round2(row.collected);
    row.open = round2(row.open);
    if (!row.invoiced && !row.collected && !row.open) continue;
    (clientRows[row.currency] || (clientRows[row.currency] = [])).push(row);
  }
  for (const list of Object.values(clientRows)) {
    list.sort((a, b) => b.collected - a.collected
      || b.invoiced - a.invoiced
      || a.name.localeCompare(b.name));
  }

  const currencies = Object.keys(totals).sort((a, b) => {
    const size = (c) => Math.abs(totals[c].collected) + Math.abs(totals[c].invoiced) + Math.abs(totals[c].open);
    return size(b) - size(a) || a.localeCompare(b);
  });

  if (base) {
    for (const key of ['invoiced', 'collected', 'taxCollected', 'open']) base[key] = round2(base[key]);
    base.missing = base.missingInvoiced + base.missingCollected + base.missingOpen;
  }

  return {
    period,
    label: periodLabel(period),
    start,
    end,
    currencies,
    totals,
    series,
    clients: clientRows,
    base,
  };
}

/** Per-currency maps for the summary tiles, in the shape moneyLines() takes. */
export function summaryLines(report, key) {
  const out = Object.create(null);
  for (const currency of report.currencies) out[currency] = report.totals[currency][key];
  return out;
}

/**
 * The visible report as CSV, for the user's accountant: one section per
 * table, so a human reading it in a spreadsheet sees the same thing they saw
 * on screen. `aged` is the aging() of the same documents; without one the
 * file simply carries no aging section.
 */
export function reportCsv(report, aged = null) {
  const rows = [];
  const line = (...cells) => rows.push(cells.map(csvEscape).join(','));
  const money = (n) => (Number(n) || 0).toFixed(2);

  line('Invoicing report', report.label);
  line('From', report.start, 'to', report.end);
  rows.push('');

  // Written off is a period total, not a monthly series: like the two counts
  // beside it, it is written on the total row and left blank on the months.
  line('Period', 'Currency', 'Invoices issued', 'Invoiced', 'Payments', 'Collected',
    'Tax collected', 'Written off');
  for (const currency of report.currencies) {
    for (const row of report.series[currency] || []) {
      line(row.label, currency, '', money(row.invoiced), '', money(row.collected), money(row.taxCollected), '');
    }
    const t = report.totals[currency];
    line(`Total ${report.label}`, currency, t.invoiceCount, money(t.invoiced),
      t.paymentCount, money(t.collected), money(t.taxCollected), money(t.writtenOff));
  }
  rows.push('');

  // Per-rate breakdown, only when any tax was actually collected: the line
  // a GST + PST filer copies into each return.
  const taxRows = report.currencies.flatMap((currency) =>
    Object.entries(report.totals[currency].taxByLabel || {})
      .filter(([, v]) => Math.abs(v) > 0.005)
      .map(([label, v]) => [label, currency, money(v)]));
  if (taxRows.length) {
    line('Tax collected by rate', 'Currency', 'Collected');
    for (const row of taxRows) line(...row);
    rows.push('');
  }

  line('Client', 'Currency', 'Invoiced', 'Collected', 'Open balance');
  for (const currency of report.currencies) {
    for (const row of report.clients[currency] || []) {
      line(row.name, currency, money(row.invoiced), money(row.collected), money(row.open));
    }
  }

  // The consolidated view, when the account asked for one: one block, with
  // the rate caveat and the count of anything left out written into the file
  // itself, so nobody reads the total as covering everything.
  if (report.base?.foreign) {
    const b = report.base;
    rows.push('');
    line(`In ${b.currency} (converted at the rate stored on each document)`, 'Amount');
    line('Invoiced', money(b.invoiced));
    line('Collected', money(b.collected));
    line('Tax collected', money(b.taxCollected));
    line('Still open', money(b.open));
    if (b.missing) {
      line('Excluded (no exchange rate)',
        `${b.missingInvoiced} invoiced, ${b.missingCollected} payments, ${b.missingOpen} open`);
    }
  }

  // How old the open money is, as its own section: the same table the page
  // shows under "Outstanding by age", so the file says what the screen did.
  const ageRows = aged ? agingCsvRows(aged) : [];
  if (ageRows.length) {
    rows.push('');
    rows.push(...ageRows);
  }

  return `${rows.join('\n')}\n`;
}
