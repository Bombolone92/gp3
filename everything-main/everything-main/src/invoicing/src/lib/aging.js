/**
 * Accounts-receivable aging: outstanding money grouped by how old it is.
 *
 * "$8,000 outstanding" says nothing on its own — $8,000 that is all fifteen
 * days out is a healthy month, and $8,000 where half is three months out is
 * a morning of phone calls. Same shape as lib/reports.js: pure functions over
 * documents, nothing stored, amounts always kept per currency.
 *
 * Age is measured from the due date, falling back to the issue date for an
 * invoice with no date at all (due on receipt). Each bucket holds the open
 * balance, not the invoice total, so a part-paid invoice only ages what is
 * left; on an invoice split into a payment schedule each open installment
 * ages by its own date (agingParts), so the half due next month is never
 * counted as late because the half due last month is. Only invoices money is
 * still expected on are counted, which is exactly isOpenInvoice() — drafts,
 * void invoices, written-off ones, settled ones, and estimates are all out.
 */

import { round2 } from './util.js';
import { docTotals } from './money.js';
import { isOpenInvoice, dueDateFor } from './doc.js';
import { daysBetween, todayISO } from './dates.js';
import { csvEscape } from './acct-csv.js';

/**
 * The buckets, oldest money last. `max` is the highest number of days past
 * due that still lands here; the final bucket takes everything beyond.
 */
export const AGING_BUCKETS = [
  { key: 'current', label: 'Not yet due', trKey: 'agingCurrent', max: 0 },
  { key: 'd30', label: '1–30 days', trKey: 'aging30', max: 30 },
  { key: 'd60', label: '31–60 days', trKey: 'aging60', max: 60 },
  { key: 'd90', label: '61–90 days', trKey: 'aging90', max: 90 },
  { key: 'over90', label: 'Over 90 days', trKey: 'agingOver90', max: Infinity },
];

export const AGING_KEYS = AGING_BUCKETS.map((b) => b.key);

/**
 * Pass as `issuedThrough` to age every document handed in, whatever its date.
 * For a caller that has already chosen the documents — a statement lists a
 * client's open invoices however they are dated — the date bound below is a
 * second, narrower filter it never asked for.
 */
export const ANY_ISSUE_DATE = '9999-12-31';

/**
 * How many days past due an invoice is as of a date; negative is early. On a
 * payment plan the age is that of the earliest installment still open — the
 * part of the money that is actually late.
 */
export function daysPastDue(doc, asOf) {
  const from = dueDateFor(doc) || doc?.issueDate;
  if (!from) return 0;
  return daysBetween(from, asOf);
}

/** The bucket a number of days past due lands in. */
const bucketFor = (days) => AGING_BUCKETS.find((b) => days <= b.max)?.key || 'over90';

/**
 * Which bucket an open invoice belongs in as of a date, read from its
 * earliest open part — the date its status is measured against. On a payment
 * plan the money itself is spread over several (agingParts); this names the
 * bucket the invoice as a whole is late by.
 */
export function agingBucket(doc, asOf) {
  return bucketFor(daysPastDue(doc, asOf));
}

/**
 * How an open invoice's balance is spread over the buckets as of a date:
 * [{ bucket, amount }], adding up to the balance.
 *
 * One part for an ordinary invoice. On a payment plan, one per installment
 * still open, each aged by its own date: the whole point of the plan is that
 * each part has its own deadline, and a plan whose first half is a month late
 * while the second is not due until autumn owes a month-late half — not, as
 * ageing the whole balance by the earliest open date said on the Reports
 * table and on the statement handed to the client, a month-late whole.
 * Whatever the plan's open parts do not account for (a refund that pushed the
 * balance past them) ages with the invoice as a whole. Nothing owed, no parts.
 */
export function agingParts(doc, asOf) {
  const { balance, installments } = docTotals(doc);
  if (balance <= 0.005) return [];
  const open = installments.filter((r) => r.open > 0.005);
  if (!open.length) return [{ bucket: agingBucket(doc, asOf), amount: balance }];
  const parts = open.map((r) => {
    const from = r.dueDate || doc?.issueDate;
    return { bucket: bucketFor(from ? daysBetween(from, asOf) : 0), amount: r.open };
  });
  const rest = round2(balance - parts.reduce((a, p) => a + p.amount, 0));
  if (Math.abs(rest) > 0.005) parts.push({ bucket: agingBucket(doc, asOf), amount: rest });
  return parts;
}

/**
 * How much of an invoice's balance is past due as of a date: the whole
 * balance once its due date has passed; on a payment plan only the parts
 * whose own dates have. Zero for anything not yet due, and for a
 * due-on-receipt invoice with no date to be late against — exactly as
 * docStatus never reads one as overdue. What the plan's open parts do not
 * account for follows the invoice's own reading, like agingParts.
 */
export function overdueAmount(doc, asOf) {
  const { balance, installments } = docTotals(doc);
  if (balance <= 0.005) return 0;
  const late = (date) => !!date && date < asOf;
  const open = installments.filter((r) => r.open > 0.005);
  const lateOpen = open.filter((r) => late(r.dueDate));
  if (!open.length || !lateOpen.length) return late(dueDateFor(doc)) ? balance : 0;
  const rest = round2(balance - open.reduce((a, r) => a + r.open, 0));
  return round2(lateOpen.reduce((a, r) => a + r.open, 0)
    + (rest > 0.005 && late(dueDateFor(doc)) ? rest : 0));
}

const emptyRow = () => {
  const row = { total: 0 };
  for (const key of AGING_KEYS) row[key] = 0;
  return row;
};

/**
 * aging(docs, clients, { asOf }) -> {
 *   asOf,
 *   currencies: [code, ...]                        // most owed first
 *   totals:  { USD: { current, d30, d60, d90, over90, total } },
 *   clients: { USD: [{ id, name, ...buckets, total }] },   // most owed first
 * }
 *
 * The buckets always add up to the same open figure reportFor() reports, so
 * the two tables on the Reports page can never disagree.
 */
export function aging(docs, clients = [], { asOf = null, issuedThrough = null } = {}) {
  const on = asOf || todayISO();
  // The latest issue date still counted. It defaults to the date being asked
  // about, so the aging of a past period does not age invoices that did not
  // exist yet — but a caller whose own figures reach further has to say so,
  // or the buckets add up to less than the total printed above them.
  const through = issuedThrough || on;
  // Keyed by currency, which is free text on an imported document: null
  // prototypes, exactly as reports.js does it, so a currency named after an
  // Object.prototype member gets a row instead of finding the prototype.
  const totals = Object.create(null);
  const byClient = new Map();
  const clientName = new Map((clients || []).map((c) => [c.id, c.company || c.name]));

  for (const doc of docs || []) {
    if (!isOpenInvoice(doc, on)) continue;
    // Nothing issued after the bound is a receivable inside it: asking for the
    // aging of a past period must not age invoices that did not exist yet.
    if (doc.issueDate && doc.issueDate > through) continue;
    const currency = doc.currency || 'USD';
    // The balance, spread over the buckets: one part for an ordinary invoice,
    // one per open installment on a payment plan.
    const parts = agingParts(doc, on);
    if (!parts.length) continue;
    const row = totals[currency] || (totals[currency] = emptyRow());

    const cid = doc.clientId || '';
    const key = `${currency}|${cid}`;
    let client = byClient.get(key);
    if (!client) {
      byClient.set(key, client = {
        id: cid, currency, name: clientName.get(cid) || 'No client', ...emptyRow(),
      });
    }
    for (const { bucket, amount } of parts) {
      row[bucket] += amount;
      row.total += amount;
      client[bucket] += amount;
      client.total += amount;
    }
  }

  const round = (row) => {
    for (const key of [...AGING_KEYS, 'total']) row[key] = round2(row[key]);
    return row;
  };
  for (const row of Object.values(totals)) round(row);

  const clientRows = Object.create(null);
  for (const row of byClient.values()) {
    round(row);
    (clientRows[row.currency] || (clientRows[row.currency] = [])).push(row);
  }
  for (const list of Object.values(clientRows)) {
    // Oldest money first: the client with the most overdue debt is the call
    // to make, not the one with the biggest balance.
    list.sort((a, b) => (b.total - b.current) - (a.total - a.current)
      || b.total - a.total
      || a.name.localeCompare(b.name));
  }

  const currencies = Object.keys(totals)
    .sort((a, b) => Math.abs(totals[b].total) - Math.abs(totals[a].total) || a.localeCompare(b));

  return { asOf: on, currencies, totals, clients: clientRows };
}

/** The aging table as CSV rows, for the section reportCsv() appends. */
export function agingCsvRows(report) {
  const rows = [];
  const line = (...cells) => rows.push(cells.map(csvEscape).join(','));
  const money = (n) => (Number(n) || 0).toFixed(2);
  if (!report.currencies.length) return rows;
  line(`Outstanding by age (as of ${report.asOf})`, 'Currency',
    ...AGING_BUCKETS.map((b) => b.label), 'Total');
  for (const currency of report.currencies) {
    for (const row of report.clients[currency] || []) {
      line(row.name, currency, ...AGING_KEYS.map((k) => money(row[k])), money(row.total));
    }
    const t = report.totals[currency];
    line('All clients', currency, ...AGING_KEYS.map((k) => money(t[k])), money(t.total));
  }
  return rows;
}

/**
 * The aging summary a statement prints: one [label, amount, currency] per
 * bucket that holds money, already translated.
 *
 * Skipped entirely when a currency's whole balance sits in one bucket — the
 * total above it already says that, and a statement is not the place for a
 * table that repeats itself. Callers pass the translator so the rows speak
 * the client's language like every other label on the paper.
 */
export function statementAgingRows(report, tr, { multi = false } = {}) {
  const out = [];
  for (const currency of report.currencies) {
    const row = report.totals[currency];
    const filled = AGING_BUCKETS.filter((b) => Math.abs(row[b.key]) > 0.005);
    if (filled.length < 2) continue;
    for (const bucket of filled) {
      out.push([`${tr(bucket.trKey)}${multi ? ` (${currency})` : ''}`, row[bucket.key], currency]);
    }
  }
  return out;
}
