/**
 * Bridge to the Personal Finance (accountant) app: every payment received
 * becomes one income row in a CSV shaped for its import wizard (Date,
 * Type, Amount, Currency, Category, Note). The wizard maps headers by name
 * and remembers the mapping, so importing is one click after the first time.
 */

import { paymentFxRate, inBase } from './money.js';

export function csvEscape(v) {
  let s = String(v ?? '');
  // Spreadsheets execute cells starting with =, +, -, or @ as formulas;
  // a leading apostrophe forces text (the standard CSV-injection guard).
  // A plain negative number is exempt: it is a number to every spreadsheet,
  // and forcing it to text would corrupt refund amounts for the app reading
  // this file, where a leading apostrophe means nothing.
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * Flatten paid amounts on invoices into income rows.
 * docs: all documents; clients: client list; category: accountant category
 * name to suggest (default 'Freelance', present in its default set).
 *
 * A refund stays an income row with a negative amount: that is how the
 * accountant app takes a correction, and it keeps the imported total equal to
 * what was actually earned.
 */
export function paymentRows(docs, clients, { category = 'Freelance', baseCurrency = '' } = {}) {
  const byId = new Map((clients || []).map((c) => [c.id, c]));
  const rows = [];
  for (const doc of docs || []) {
    if (doc.kind !== 'invoice' || doc.status === 'void') continue;
    for (const p of doc.payments || []) {
      const client = byId.get(doc.clientId);
      // The convention everywhere a client is named in one slot: company
      // first, person second. A restored backup can hold a client with
      // neither — interpolating the raw field printed "· undefined".
      const who = String(client?.company || client?.name || '').trim();
      const amount = Number(p.amount) || 0;
      // What this payment was worth in the user's own money, when a rate was
      // recorded for it. A single-currency ledger wants that column; a
      // payment with no rate leaves it empty rather than guessing parity.
      const rate = baseCurrency ? paymentFxRate(p, doc, baseCurrency) : null;
      rows.push({
        date: p.date,
        type: 'income',
        amount,
        currency: doc.currency,
        category,
        note: `${amount < 0 ? 'Refund · ' : ''}${doc.number}`
          + `${who ? ` · ${who}` : ''}${p.method ? ` · ${p.method}` : ''}`,
        baseAmount: rate === null ? null : inBase(amount, rate),
        baseCurrency: rate === null ? '' : baseCurrency,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

export function paymentsCsv(docs, clients, opts) {
  const rows = paymentRows(docs, clients, opts);
  // The extra pair of columns only appears for an account that actually
  // bills in more than its own currency: the wizard maps headers by name,
  // and two empty columns on every other account is noise it would have to
  // map away every time.
  const converted = rows.some((r) => r.baseAmount !== null && r.baseCurrency !== r.currency);
  const head = `Date,Type,Amount,Currency,Category,Note${converted ? ',Base amount,Base currency' : ''}`;
  const lines = rows.map((r) => [
    r.date, r.type, r.amount.toFixed(2), r.currency, r.category, r.note,
    ...(converted
      ? [r.baseAmount === null ? '' : r.baseAmount.toFixed(2), r.baseCurrency]
      : []),
  ].map(csvEscape).join(','));
  return [head, ...lines].join('\n') + '\n';
}
