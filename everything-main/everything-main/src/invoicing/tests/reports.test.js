import { describe, it, expect } from 'vitest';
import {
  periodRange, periodLabel, subPeriods, reportYears, reportFor, summaryLines, reportCsv,
} from '../src/lib/reports.js';
import { aging } from '../src/lib/aging.js';

const clients = [
  { id: 'c1', name: 'Maya Chen', company: 'Northwind Labs' },
  { id: 'c2', name: 'Sam Ortiz', company: '' },
];

const invoice = (over = {}) => ({
  kind: 'invoice',
  status: 'sent',
  clientId: 'c1',
  currency: 'USD',
  issueDate: '2026-02-10',
  dueDate: '2026-03-10',
  items: [{ qty: 1, rate: 1000 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  payments: [],
  ...over,
});

const year = (y = 2026) => ({ kind: 'year', year: y, index: 1 });

describe('periodRange', () => {
  it('covers a whole year, quarter, and month', () => {
    expect(periodRange({ kind: 'year', year: 2026 })).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodRange({ kind: 'quarter', year: 2026, index: 1 })).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(periodRange({ kind: 'quarter', year: 2026, index: 4 })).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(periodRange({ kind: 'month', year: 2026, index: 2 })).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRange({ kind: 'month', year: 2024, index: 2 })).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });

  it('clamps a nonsense index instead of producing an invalid range', () => {
    expect(periodRange({ kind: 'month', year: 2026, index: 99 }).start).toBe('2026-12-01');
    expect(periodRange({ kind: 'quarter', year: 2026, index: 0 }).start).toBe('2026-01-01');
  });
});

describe('periodLabel', () => {
  it('names the period the way a user would', () => {
    expect(periodLabel({ kind: 'year', year: 2026 })).toBe('2026');
    expect(periodLabel({ kind: 'quarter', year: 2026, index: 3 })).toBe('Q3 2026');
    expect(periodLabel({ kind: 'month', year: 2026, index: 8 })).toMatch(/2026/);
  });
});

describe('subPeriods', () => {
  it('breaks a year into months and a quarter into its three', () => {
    expect(subPeriods({ kind: 'year', year: 2026 })).toHaveLength(12);
    const q = subPeriods({ kind: 'quarter', year: 2026, index: 2 });
    expect(q.map((b) => b.key)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(subPeriods({ kind: 'month', year: 2026, index: 5 })).toHaveLength(1);
  });
});

describe('reportYears', () => {
  it('lists every year with activity, newest first', () => {
    const docs = [
      invoice({ issueDate: '2024-06-01' }),
      invoice({ issueDate: '2026-01-01', payments: [{ amount: 10, date: '2027-01-05' }] }),
    ];
    expect(reportYears(docs, '2026-08-04')).toEqual(['2027', '2026', '2024']);
  });

  it('always offers the current year, even with no data', () => {
    expect(reportYears([], '2026-08-04')).toEqual(['2026']);
  });
});

describe('reportFor', () => {
  it('separates what was invoiced from what was collected', () => {
    const docs = [
      invoice({ issueDate: '2026-02-10', payments: [{ amount: 400, date: '2026-03-01' }] }),
      // Issued last year, paid inside the period: cash yes, accrual no.
      invoice({ issueDate: '2025-12-20', payments: [{ amount: 250, date: '2026-01-15' }] }),
      // Issued inside the period, still unpaid: accrual yes, cash no.
      invoice({ issueDate: '2026-11-01', items: [{ qty: 1, rate: 500 }] }),
    ];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.invoiced).toBe(1500);
    expect(r.totals.USD.collected).toBe(650);
    expect(r.totals.USD.invoiceCount).toBe(2);
    expect(r.totals.USD.paymentCount).toBe(2);
  });

  it('prorates tax by what was actually paid', () => {
    // 1000 + 10% tax = 1100 total, of which 100 is tax. Half paid -> half the tax.
    const docs = [invoice({
      taxRate: 10,
      payments: [{ amount: 550, date: '2026-03-01' }],
    })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.invoiced).toBe(1100);
    expect(r.totals.USD.taxInvoiced).toBe(100);
    expect(r.totals.USD.taxCollected).toBe(50);
  });

  it('prorates each named tax by what was paid, per label', () => {
    // 1000 + GST 50 + PST 70 = 1120 total; half paid -> half of each.
    const docs = [invoice({
      taxes: [{ label: 'GST', rate: 5 }, { label: 'PST', rate: 7 }],
      payments: [{ amount: 560, date: '2026-03-01' }],
    })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.taxCollected).toBe(60);
    expect(r.totals.USD.taxByLabel).toEqual({ 'GST (5%)': 25, 'PST (7%)': 35 });
    // The CSV carries the per-rate lines an accountant files from.
    const csv = reportCsv(r);
    expect(csv).toContain('Tax collected by rate');
    expect(csv).toContain('GST (5%),USD,25.00');
    expect(csv).toContain('PST (7%),USD,35.00');
  });

  it('labels a legacy single-rate tax as plain Tax in the breakdown', () => {
    const docs = [invoice({
      taxRate: 10,
      payments: [{ amount: 1100, date: '2026-03-01' }],
    })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.taxByLabel).toEqual({ 'Tax (10%)': 100 });
  });

  it('counts the full tax once an invoice is fully paid', () => {
    const docs = [invoice({
      taxRate: 8.5,
      payments: [{ amount: 600, date: '2026-03-01' }, { amount: 485, date: '2026-04-02' }],
    })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.invoiced).toBe(1085);
    expect(r.totals.USD.collected).toBe(1085);
    expect(r.totals.USD.taxCollected).toBe(85);
  });

  it('excludes void invoices and estimates entirely', () => {
    const docs = [
      invoice({ status: 'void', payments: [{ amount: 1000, date: '2026-03-01' }] }),
      { ...invoice(), kind: 'quote', status: 'accepted' },
    ];
    const r = reportFor(docs, clients, year());
    expect(r.currencies).toEqual([]);
    expect(r.totals).toEqual({});
  });

  it('leaves drafts out of invoiced and open, the way the rest of the app reads them', () => {
    const docs = [
      invoice({ status: 'draft' }),
      invoice({ status: 'draft', issueDate: '2025-06-01' }),
    ];
    const r = reportFor(docs, clients, year());
    expect(r.currencies).toEqual([]);
    expect(r.clients).toEqual({});
  });

  it('still counts money that arrived against a draft', () => {
    const docs = [invoice({ status: 'draft', payments: [{ amount: 400, date: '2026-03-01' }] })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.collected).toBe(400);
    expect(r.totals.USD.invoiced).toBe(0);
    expect(r.totals.USD.invoiceCount).toBe(0);
    expect(r.totals.USD.open).toBe(0);
  });

  it('never mixes currencies', () => {
    const docs = [
      invoice({ currency: 'USD', payments: [{ amount: 1000, date: '2026-03-01' }] }),
      invoice({ currency: 'EUR', items: [{ qty: 1, rate: 2000 }], payments: [{ amount: 2000, date: '2026-03-02' }] }),
    ];
    const r = reportFor(docs, clients, year());
    expect(r.currencies).toEqual(['EUR', 'USD']);      // busiest first
    expect(r.totals.USD.collected).toBe(1000);
    expect(r.totals.EUR.collected).toBe(2000);
    expect(summaryLines(r, 'collected')).toEqual({ EUR: 2000, USD: 1000 });
  });

  it('places invoices and payments in the month they happened', () => {
    const docs = [invoice({ issueDate: '2026-02-10', payments: [{ amount: 1000, date: '2026-05-20' }] })];
    const r = reportFor(docs, clients, year());
    const feb = r.series.USD.find((b) => b.key === '2026-02');
    const may = r.series.USD.find((b) => b.key === '2026-05');
    expect(feb.invoiced).toBe(1000);
    expect(feb.collected).toBe(0);
    expect(may.collected).toBe(1000);
    expect(may.invoiced).toBe(0);
    expect(r.series.USD).toHaveLength(12);
  });

  it('ranks clients by what they actually paid and shows what they still owe', () => {
    const docs = [
      invoice({ clientId: 'c1', payments: [{ amount: 300, date: '2026-03-01' }] }),
      invoice({ clientId: 'c2', items: [{ qty: 1, rate: 800 }], payments: [{ amount: 800, date: '2026-03-02' }] }),
    ];
    const r = reportFor(docs, clients, year());
    expect(r.clients.USD.map((c) => [c.name, c.collected, c.open]))
      .toEqual([['Sam Ortiz', 800, 0], ['Northwind Labs', 300, 700]]);
  });

  it('labels documents with no client rather than dropping them', () => {
    const r = reportFor([invoice({ clientId: '' })], clients, year());
    expect(r.clients.USD[0].name).toBe('No client');
  });

  it('keeps a quarter to its own three months', () => {
    const docs = [
      invoice({ issueDate: '2026-02-10' }),
      invoice({ issueDate: '2026-05-10', items: [{ qty: 1, rate: 700 }] }),
    ];
    const r = reportFor(docs, clients, { kind: 'quarter', year: 2026, index: 2 });
    expect(r.totals.USD.invoiced).toBe(700);
    expect(r.label).toBe('Q2 2026');
  });

  it('reports a period with no activity and nothing owed as empty', () => {
    const settled = invoice({ issueDate: '2024-01-01', payments: [{ amount: 1000, date: '2024-02-01' }] });
    const r = reportFor([settled], clients, year());
    expect(r.currencies).toEqual([]);
    expect(r.clients).toEqual({});
  });

  it('leaves an overpaid invoice out of open, like every other reader', () => {
    // A $150 payment against a $100 invoice is a credit the user owes back,
    // not money still expected: docStatus reads it as paid, the aging table
    // and the client's page leave it out, and this figure has to agree.
    const doc = invoice({
      issueDate: '2026-03-01',
      items: [{ qty: 1, rate: 100 }],
      payments: [{ date: '2026-03-10', amount: 150 }],
    });
    const r = reportFor([doc], clients, { kind: 'year', year: 2026 });
    expect(r.totals.USD.open).toBe(0);
    expect(r.clients.USD.map((c) => c.open)).toEqual([0]);
    // The money that did arrive is still collected.
    expect(r.totals.USD.collected).toBe(150);
  });

  it('counts open balances from earlier periods that are still owed', () => {
    const docs = [invoice({ issueDate: '2025-06-01' })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.open).toBe(1000);
    expect(r.totals.USD.invoiced).toBe(0);
  });

  it('nets a negative payment out of what was collected', () => {
    const docs = [invoice({
      payments: [{ amount: 1000, date: '2026-03-01' }, { amount: -250, date: '2026-04-01' }],
    })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.collected).toBe(750);
    expect(r.totals.USD.open).toBe(250);
  });
});

describe('reportCsv', () => {
  it('writes the sections that are on screen', () => {
    const docs = [invoice({ taxRate: 10, payments: [{ amount: 550, date: '2026-03-01' }] })];
    const csv = reportCsv(reportFor(docs, clients, year()));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Invoicing report,2026');
    expect(csv).toContain('Period,Currency,Invoices issued,Invoiced,Payments,Collected,Tax collected');
    expect(csv).toContain('Total 2026,USD,1,1100.00,1,550.00,50.00');
    expect(csv).toContain('Client,Currency,Invoiced,Collected,Open balance');
    expect(csv).toContain('Northwind Labs,USD,1100.00,550.00,550.00');
  });

  it('escapes a client name that would break the file or a spreadsheet', () => {
    const docs = [invoice({ clientId: 'c3' })];
    const csv = reportCsv(reportFor(docs, [{ id: 'c3', name: '=cmd|x', company: 'A, B "C"' }], year()));
    expect(csv).toContain('"A, B ""C"""');
    const only = reportCsv(reportFor(docs, [{ id: 'c3', name: '=cmd|x' }], year()));
    expect(only).toContain("'=cmd|x");
  });
});

describe('a currency named like an Object.prototype member', () => {
  // doc.currency is free text on an imported document; it must get a row
  // of its own, not "find" — and write onto — the shared prototype.
  it('neither crashes nor pollutes the prototype', () => {
    const docs = [{
      id: 'd1', kind: 'invoice', status: 'sent', number: 'INV-1', currency: '__proto__',
      issueDate: '2026-07-01', items: [{ qty: 1, rate: 100 }],
      payments: [{ id: 'p1', date: '2026-07-05', amount: 50 }],
    }];
    const report = reportFor(docs, [], { kind: 'year', year: 2026 });
    expect({}.invoiced).toBeUndefined();
    expect({}.invoiceCount).toBeUndefined();
    expect(report.currencies).toContain('__proto__');
    expect(report.totals['__proto__'].invoiced).toBe(100);
    expect(report.totals['__proto__'].collected).toBe(50);
    expect(report.clients['__proto__']).toHaveLength(1);
    expect(summaryLines(report, 'collected')['__proto__']).toBe(50);
    expect(reportCsv(report)).toContain('__proto__');
  });
});

describe('overpayment tax proration', () => {
  it('never reports more tax collected than the invoice charged', () => {
    // 1000 + 10% = 1100 total, 100 tax; the client mistakenly pays 1200.
    const docs = [invoice({
      taxRate: 10,
      payments: [{ amount: 1200, date: '2026-03-01' }],
    })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.collected).toBe(1200);
    expect(r.totals.USD.taxCollected).toBe(100);
    expect(r.totals.USD.taxByLabel).toEqual({ 'Tax (10%)': 100 });
  });

  it('gives a later period only the tax the earlier ones left', () => {
    const docs = [invoice({
      taxRate: 10,
      payments: [{ amount: 600, date: '2025-12-10' }, { amount: 600, date: '2026-01-10' }],
    })];
    // 2025 collected 600 x 100/1100 = 54.55 of the tax; 2026 gets the rest.
    expect(reportFor(docs, clients, { kind: 'year', year: 2025 }).totals.USD.taxCollected).toBe(54.55);
    expect(reportFor(docs, clients, year()).totals.USD.taxCollected).toBe(45.45);
  });

  it('refunding an overpayment refunds no tax', () => {
    const docs = [invoice({
      taxRate: 10,
      payments: [{ amount: 1200, date: '2026-03-01' }, { amount: -100, date: '2026-04-01' }],
    })];
    const r = reportFor(docs, clients, year());
    expect(r.totals.USD.collected).toBe(1100);
    expect(r.totals.USD.taxCollected).toBe(100);
  });
});

describe('written-off invoices in a report', () => {
  const written = (over = {}) => invoice({
    writeOff: { date: '2026-06-01', reason: 'gone' }, ...over,
  });

  it('stays invoiced, leaves open, and reports what was given up', () => {
    const report = reportFor([written()], clients, year());
    const t = report.totals.USD;
    expect(t.invoiced).toBe(1000);
    expect(t.open).toBe(0);
    expect(t.writtenOff).toBe(1000);
    // And the client row's open balance drops with it.
    expect(report.clients.USD[0].open).toBe(0);
    expect(report.clients.USD[0].invoiced).toBe(1000);
  });

  it('counts only what is still unpaid', () => {
    const part = reportFor([written({ payments: [{ date: '2026-03-01', amount: 400 }] })], clients, year());
    expect(part.totals.USD.writtenOff).toBe(600);
    expect(part.totals.USD.collected).toBe(400);
    // Paid in full after the write-off: nothing was actually given up.
    const paid = reportFor([written({ payments: [{ date: '2026-03-01', amount: 1000 }] })], clients, year());
    expect(paid.totals.USD.writtenOff).toBe(0);
  });

  it('is zero for a period the invoice was not issued in', () => {
    const report = reportFor([written()], clients, { kind: 'quarter', year: 2026, index: 3 });
    expect(report.totals.USD?.writtenOff ?? 0).toBe(0);
  });

  it('leaves an ordinary invoice reading exactly as before', () => {
    const t = reportFor([invoice()], clients, year()).totals.USD;
    expect(t.writtenOff).toBe(0);
    expect(t.open).toBe(1000);
  });

  it('writes a written-off column into the CSV', () => {
    const csv = reportCsv(reportFor([written(), invoice({ id: 'b', issueDate: '2026-04-04' })], clients, year()));
    const header = csv.split('\n')[3];
    expect(header).toContain('Written off');
    const total = csv.split('\n').find((l) => l.startsWith('Total 2026'));
    expect(total.endsWith(',1000.00')).toBe(true);
  });
});

describe('the aging section of the CSV', () => {
  it('is appended when the caller hands over an aging report', () => {
    const docs = [invoice({ dueDate: '2026-03-10' }), invoice({ id: 'b', clientId: 'c2', dueDate: '2026-12-30' })];
    const csv = reportCsv(reportFor(docs, clients, year()), aging(docs, clients, { asOf: '2026-08-04' }));
    expect(csv).toContain('Outstanding by age (as of 2026-08-04)');
    expect(csv).toContain('All clients,USD');
  });

  it('leaves the file exactly as it was when no aging is handed over', () => {
    const csv = reportCsv(reportFor([invoice()], clients, year()));
    expect(csv).not.toContain('Outstanding by age');
  });
});

describe('consolidating into a base currency', () => {
  const eur = (over = {}) => invoice({ currency: 'EUR', ...over });

  it('is absent unless a base currency is asked for', () => {
    expect(reportFor([invoice()], clients, year()).base).toBe(null);
  });

  it('converts each document at its own stored rate', () => {
    const docs = [
      invoice({ id: 'a' }),                                   // 1000 USD, no rate needed
      eur({ id: 'b', fxRate: 1.1, payments: [{ date: '2026-03-01', amount: 500 }] }),
    ];
    const b = reportFor(docs, clients, year(), { baseCurrency: 'USD' }).base;
    expect(b.currency).toBe('USD');
    expect(b.invoiced).toBe(2100);        // 1000 + 1000 × 1.1
    expect(b.collected).toBe(550);        // 500 × 1.1
    expect(b.open).toBe(1550);            // 1000 + 500 × 1.1
    expect(b.missing).toBe(0);
    expect(b.foreign).toBe(true);
  });

  it('stays out of the way for a foreign draft nobody has been billed for', () => {
    const b = reportFor([eur({ status: 'draft', fxRate: 2 })], clients, year(), { baseCurrency: 'USD' }).base;
    expect(b.foreign).toBe(false);
  });

  it('needs no rate when the document is already in the base currency', () => {
    const b = reportFor([invoice()], clients, year(), { baseCurrency: 'USD' }).base;
    expect(b.invoiced).toBe(1000);
    expect(b.missing).toBe(0);
    // Nothing foreign here, so the block has nothing to add.
    expect(b.foreign).toBe(false);
  });

  it('excludes what carries no rate, and counts it', () => {
    const docs = [eur({ id: 'a', payments: [{ date: '2026-03-01', amount: 200 }] })];
    const b = reportFor(docs, clients, year(), { baseCurrency: 'USD' }).base;
    expect(b.invoiced).toBe(0);
    expect(b.collected).toBe(0);
    expect(b.missingInvoiced).toBe(1);
    expect(b.missingCollected).toBe(1);
    expect(b.missingOpen).toBe(1);
    expect(b.missing).toBe(3);
  });

  it('never treats a zero or nonsense rate as parity', () => {
    for (const fxRate of [0, -2, 'abc', null]) {
      const b = reportFor([eur({ fxRate })], clients, year(), { baseCurrency: 'USD' }).base;
      expect(b.invoiced, String(fxRate)).toBe(0);
      expect(b.missingInvoiced, String(fxRate)).toBe(1);
    }
  });

  it('lets a payment carry its own rate, overriding the document’s', () => {
    const docs = [eur({ fxRate: 1.1, payments: [{ date: '2026-03-01', amount: 500, fxRate: 1.3 }] })];
    const b = reportFor(docs, clients, year(), { baseCurrency: 'USD' }).base;
    expect(b.collected).toBe(650);
  });

  it('converts the tax it collected too', () => {
    const docs = [eur({ fxRate: 2, taxes: [{ label: 'VAT', rate: 10 }], payments: [{ date: '2026-03-01', amount: 1100 }] })];
    const b = reportFor(docs, clients, year(), { baseCurrency: 'USD' }).base;
    expect(b.collected).toBe(2200);
    expect(b.taxCollected).toBe(200);
  });

  it('writes the block, and what it left out, into the CSV', () => {
    const docs = [eur({ id: 'a', fxRate: 1.5 }), eur({ id: 'b' })];
    const csv = reportCsv(reportFor(docs, clients, year(), { baseCurrency: 'USD' }));
    expect(csv).toContain('In USD (converted at the rate stored on each document)');
    expect(csv).toContain('Invoiced,1500.00');
    expect(csv).toContain('Excluded (no exchange rate)');
  });

  it('leaves the CSV alone for a single-currency account', () => {
    const csv = reportCsv(reportFor([invoice()], clients, year(), { baseCurrency: 'USD' }));
    expect(csv).not.toContain('In USD (converted');
  });
});
