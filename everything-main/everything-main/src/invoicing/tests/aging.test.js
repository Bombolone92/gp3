import { describe, it, expect } from 'vitest';
import {
  AGING_BUCKETS, aging, agingBucket, agingParts, overdueAmount, daysPastDue, agingCsvRows,
  statementAgingRows, ANY_ISSUE_DATE,
} from '../src/lib/aging.js';
import { translator } from '../src/lib/i18n.js';
import { reportFor } from '../src/lib/reports.js';

const TODAY = '2026-08-04';

const clients = [
  { id: 'c1', name: 'Maya Chen', company: 'Northwind Labs' },
  { id: 'c2', name: 'Sam Ortiz', company: '' },
];

const invoice = (over = {}) => ({
  id: 'i1',
  kind: 'invoice',
  status: 'sent',
  clientId: 'c1',
  currency: 'USD',
  issueDate: '2026-05-01',
  dueDate: '2026-08-01',
  items: [{ qty: 1, rate: 1000 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  payments: [],
  ...over,
});

/* An invoice split into two halves: the first a month late as of TODAY, the
   second not due until September. */
const plan = (over = {}) => invoice({
  items: [{ qty: 1, rate: 3000 }],
  schedule: [
    { id: 'a', label: 'On signing', dueDate: '2026-07-01', type: 'percent', value: 50 },
    { id: 'b', label: 'On delivery', dueDate: '2026-09-01', type: 'percent', value: 50 },
  ],
  ...over,
});

describe('bucket boundaries', () => {
  it('counts days from the due date', () => {
    expect(daysPastDue(invoice({ dueDate: '2026-08-01' }), TODAY)).toBe(3);
    expect(daysPastDue(invoice({ dueDate: '2026-09-01' }), TODAY)).toBe(-28);
  });

  it('puts exactly 30 days late in 1–30, and 31 in 31–60', () => {
    expect(agingBucket(invoice({ dueDate: '2026-07-05' }), TODAY)).toBe('d30');
    expect(agingBucket(invoice({ dueDate: '2026-07-04' }), TODAY)).toBe('d60');
  });

  it('puts exactly 60 and 90 days late in their own bands', () => {
    expect(agingBucket(invoice({ dueDate: '2026-06-05' }), TODAY)).toBe('d60');
    expect(agingBucket(invoice({ dueDate: '2026-06-04' }), TODAY)).toBe('d90');
    expect(agingBucket(invoice({ dueDate: '2026-05-06' }), TODAY)).toBe('d90');
    expect(agingBucket(invoice({ dueDate: '2026-05-05' }), TODAY)).toBe('over90');
  });

  it('reads due today, and not yet due, as current', () => {
    expect(agingBucket(invoice({ dueDate: TODAY }), TODAY)).toBe('current');
    expect(agingBucket(invoice({ dueDate: '2026-12-01' }), TODAY)).toBe('current');
  });

  it('falls back to the issue date when an invoice is due on receipt', () => {
    expect(agingBucket(invoice({ dueDate: '', issueDate: '2026-07-01' }), TODAY)).toBe('d60');
    expect(agingBucket(invoice({ dueDate: undefined, issueDate: TODAY }), TODAY)).toBe('current');
  });
});

describe('aging', () => {
  it('ages the open balance, not the invoice total', () => {
    const report = aging([invoice({ payments: [{ date: '2026-08-02', amount: 400 }] })], clients, { asOf: TODAY });
    expect(report.totals.USD.d30).toBe(600);
    expect(report.totals.USD.total).toBe(600);
  });

  it('leaves out drafts, void, written-off, settled invoices and estimates', () => {
    const docs = [
      invoice({ id: 'a', status: 'draft' }),
      invoice({ id: 'b', status: 'void' }),
      invoice({ id: 'c', writeOff: { date: '2026-08-01' } }),
      invoice({ id: 'd', payments: [{ date: '2026-08-02', amount: 1000 }] }),
      invoice({ id: 'e', kind: 'quote' }),
    ];
    expect(aging(docs, clients, { asOf: TODAY }).currencies).toEqual([]);
  });

  it('keeps currencies apart', () => {
    const report = aging([
      invoice({ id: 'a', currency: 'USD' }),
      invoice({ id: 'b', currency: 'EUR', dueDate: '2026-01-01' }),
    ], clients, { asOf: TODAY });
    expect(report.totals.USD.d30).toBe(1000);
    expect(report.totals.EUR.over90).toBe(1000);
    expect(report.currencies).toEqual(['EUR', 'USD']);
  });

  it('adds up to the open figure the rest of the report shows', () => {
    const docs = [
      invoice({ id: 'a', dueDate: '2026-08-20' }),
      invoice({ id: 'b', dueDate: '2026-07-01', payments: [{ date: '2026-07-20', amount: 250 }] }),
      invoice({ id: 'c', dueDate: '2026-01-04', clientId: 'c2' }),
    ];
    const aged = aging(docs, clients, { asOf: TODAY });
    const report = reportFor(docs, clients, { kind: 'year', year: 2026, index: 1 });
    expect(aged.totals.USD.total).toBe(report.totals.USD.open);
    const buckets = AGING_BUCKETS.reduce((sum, b) => sum + aged.totals.USD[b.key], 0);
    expect(Math.round(buckets * 100) / 100).toBe(aged.totals.USD.total);
  });

  it('still agrees with it when one invoice is dated later in the period', () => {
    const docs = [
      invoice({ id: 'a', dueDate: '2026-08-30' }),
      invoice({ id: 'b', issueDate: '2026-11-01', dueDate: '2026-11-30' }),
    ];
    const report = reportFor(docs, clients, { kind: 'year', year: 2026, index: 1 });
    const aged = aging(docs, clients, { asOf: TODAY, issuedThrough: report.end });
    expect(aged.totals.USD.total).toBe(report.totals.USD.open);
  });

  it('breaks down by client, oldest debt first', () => {
    const aged = aging([
      invoice({ id: 'a', clientId: 'c1', dueDate: '2026-08-30', items: [{ qty: 1, rate: 9000 }] }),
      invoice({ id: 'b', clientId: 'c2', dueDate: '2026-01-01', items: [{ qty: 1, rate: 300 }] }),
    ], clients, { asOf: TODAY });
    expect(aged.clients.USD.map((r) => r.name)).toEqual(['Sam Ortiz', 'Northwind Labs']);
    expect(aged.clients.USD[0].over90).toBe(300);
    expect(aged.clients.USD[1].current).toBe(9000);
  });

  it('names a document with no client rather than dropping it', () => {
    const aged = aging([invoice({ clientId: '' })], clients, { asOf: TODAY });
    expect(aged.clients.USD[0].name).toBe('No client');
  });

  it('ignores invoices issued after the date it is asked about', () => {
    const aged = aging([invoice({ issueDate: '2026-09-01', dueDate: '2026-09-30' })], clients, { asOf: TODAY });
    expect(aged.currencies).toEqual([]);
  });

  it('ages one issued later when the caller says how far its own figures reach', () => {
    // Reports' "Still open" counts everything issued up to the end of the
    // period, so the table under it has to cover the same slice: a post-dated
    // invoice sat in that figure and was missing from every bucket.
    const aged = aging([invoice({ issueDate: '2026-11-01', dueDate: '2026-11-30' })], clients,
      { asOf: TODAY, issuedThrough: '2026-12-31' });
    expect(aged.totals.USD.current).toBe(1000);
    expect(aged.totals.USD.total).toBe(1000);
  });

  it('ages every invoice handed in when the bound is lifted', () => {
    const aged = aging([invoice({ issueDate: '2026-11-01', dueDate: '2026-11-30' })], clients,
      { asOf: TODAY, issuedThrough: ANY_ISSUE_DATE });
    expect(aged.totals.USD.total).toBe(1000);
  });
});

describe('a payment plan', () => {
  it('ages each open installment by its own date', () => {
    // As of Aug 4 the July half is 34 days late; the September half is not
    // due. Aged by the earliest open date, the whole $3,000 read as a month
    // late — on the Reports table and on the statement handed to the client.
    const aged = aging([plan()], clients, { asOf: TODAY });
    expect(aged.totals.USD.d60).toBe(1500);
    expect(aged.totals.USD.current).toBe(1500);
    expect(aged.totals.USD.total).toBe(3000);
    expect(aged.clients.USD[0].d60).toBe(1500);
    expect(agingParts(plan(), TODAY)).toEqual([
      { bucket: 'd60', amount: 1500 },
      { bucket: 'current', amount: 1500 },
    ]);
  });

  it('ages what is left of a part-paid installment, and still adds up to the open figure', () => {
    const docs = [plan({ payments: [{ date: '2026-07-10', amount: 1000 }] })];
    const aged = aging(docs, clients, { asOf: TODAY });
    expect(aged.totals.USD.d60).toBe(500);
    expect(aged.totals.USD.current).toBe(1500);
    const report = reportFor(docs, clients, { kind: 'year', year: 2026, index: 1 });
    expect(aged.totals.USD.total).toBe(report.totals.USD.open);
  });

  it('ages a balance the plan does not account for with the invoice as a whole', () => {
    // A refund with nothing paid before it: every part is open and the
    // balance is more than the plan asks for; the excess follows the
    // invoice's own reading, which is late by its earliest open part.
    const aged = aging([plan({ payments: [{ date: '2026-07-10', amount: -300 }] })], clients, { asOf: TODAY });
    expect(aged.totals.USD.d60).toBe(1800);
    expect(aged.totals.USD.current).toBe(1500);
    expect(aged.totals.USD.total).toBe(3300);
  });

  it('leaves an invoice without a plan exactly as it was', () => {
    expect(agingParts(invoice(), TODAY)).toEqual([{ bucket: 'd30', amount: 1000 }]);
    expect(agingParts(invoice({ payments: [{ date: '2026-08-02', amount: 1000 }] }), TODAY)).toEqual([]);
  });
});

describe('overdueAmount', () => {
  it('is the whole balance once an ordinary invoice is past due, and nothing before', () => {
    expect(overdueAmount(invoice({ dueDate: '2026-08-01' }), TODAY)).toBe(1000);
    expect(overdueAmount(invoice({ dueDate: TODAY }), TODAY)).toBe(0);
    expect(overdueAmount(invoice({ dueDate: '2026-09-01' }), TODAY)).toBe(0);
    // Due on receipt has no date to be late against, as docStatus reads it.
    expect(overdueAmount(invoice({ dueDate: '' }), TODAY)).toBe(0);
    expect(overdueAmount(invoice({ payments: [{ date: '2026-08-02', amount: 1000 }] }), TODAY)).toBe(0);
  });

  it('is only the late parts of a payment plan', () => {
    expect(overdueAmount(plan(), TODAY)).toBe(1500);
    expect(overdueAmount(plan({ payments: [{ date: '2026-07-10', amount: 1000 }] }), TODAY)).toBe(500);
    expect(overdueAmount(plan({ payments: [{ date: '2026-07-10', amount: 1500 }] }), TODAY)).toBe(0);
    expect(overdueAmount(plan({ payments: [{ date: '2026-07-10', amount: -300 }] }), TODAY)).toBe(1800);
  });
});

describe('the CSV section', () => {
  it('writes a row per client and a total row', () => {
    const rows = agingCsvRows(aging([
      invoice({ id: 'a', dueDate: '2026-07-01' }),
      invoice({ id: 'b', clientId: 'c2', dueDate: '2026-08-30' }),
    ], clients, { asOf: TODAY }));
    expect(rows[0]).toContain('Outstanding by age (as of 2026-08-04)');
    expect(rows[0]).toContain('Over 90 days');
    expect(rows.at(-1).startsWith('All clients,USD,')).toBe(true);
    expect(rows.at(-1).endsWith(',2000.00')).toBe(true);
  });

  it('writes nothing at all when nothing is outstanding', () => {
    expect(agingCsvRows(aging([], clients, { asOf: TODAY }))).toEqual([]);
  });
});

describe('the statement summary', () => {
  const tr = translator('');
  it('lists every bucket holding money', () => {
    const aged = aging([
      invoice({ id: 'a', dueDate: '2026-07-20' }),
      invoice({ id: 'b', dueDate: '2026-01-01' }),
    ], clients, { asOf: TODAY });
    expect(statementAgingRows(aged, tr)).toEqual([
      ['1–30 days', 1000, 'USD'],
      ['Over 90 days', 1000, 'USD'],
    ]);
  });

  it('says nothing when the whole balance is one age', () => {
    const aged = aging([invoice()], clients, { asOf: TODAY });
    expect(statementAgingRows(aged, tr)).toEqual([]);
  });

  it('names the currency when a client is billed in two', () => {
    const aged = aging([
      invoice({ id: 'a', currency: 'EUR', dueDate: '2026-07-20' }),
      invoice({ id: 'b', currency: 'EUR', dueDate: '2026-01-01' }),
    ], clients, { asOf: TODAY });
    expect(statementAgingRows(aged, tr, { multi: true })[0][0]).toBe('1–30 days (EUR)');
  });

  it('speaks the client’s language', () => {
    const aged = aging([
      invoice({ id: 'a', dueDate: '2026-07-20' }),
      invoice({ id: 'b', dueDate: '2026-01-01' }),
    ], clients, { asOf: TODAY });
    expect(statementAgingRows(aged, translator('de'))[0][0]).toBe('1–30 Tage');
  });
});
