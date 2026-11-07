import { describe, it, expect } from 'vitest';
import { parseCsv } from '../src/lib/csv.js';
import {
  CLIENT_FIELDS, INVOICE_FIELDS, LINE_ITEM_FIELDS, guessMapping, parseNumber, parseDate,
  parseCurrency, prepareClients, prepareInvoices, prepareLineItems, importSummary,
} from '../src/lib/import-csv.js';
import { docTotals } from '../src/lib/money.js';

describe('parseNumber', () => {
  it('reads the ways people and apps write money', () => {
    expect(parseNumber('1234.56')).toBe(1234.56);
    expect(parseNumber('$1,234.56')).toBe(1234.56);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1 234,56')).toBe(1234.56);
    expect(parseNumber('1234,56')).toBe(1234.56);
    expect(parseNumber('12,345,678')).toBe(12345678);
    expect(parseNumber('(120.00)')).toBe(-120);
    expect(parseNumber('-5')).toBe(-5);
    // The typographic minus Intl writes for sv-SE, fi-FI, nb-NO and friends.
    expect(parseNumber('\u22121 200,50')).toBe(-1200.5);
    expect(parseNumber('\u2212250,00 \u20ac')).toBe(-250);
    expect(parseNumber('\u2212\u22125')).toBe(null);
    expect(parseNumber('0')).toBe(0);
  });

  it('refuses what is not a number, rather than reading it as zero', () => {
    for (const junk of ['', '   ', 'abc', 'N/A', '-', null, undefined]) {
      expect(parseNumber(junk), String(junk)).toBe(null);
    }
  });

  it('refuses an exponent or a doubled sign instead of misreading it', () => {
    // Stripping the letters read "1E+21" as 121 and "--5" as 5.
    for (const junk of ['1E+21', '1e5', '1.5E3', '--5', '1-2', '5-']) {
      expect(parseNumber(junk), junk).toBe(null);
    }
    // A currency code beside the amount is still fine.
    expect(parseNumber('EUR 5')).toBe(5);
    expect(parseNumber('5 EUR')).toBe(5);
  });

  it('refuses a clock time or a duration instead of reading its digits', () => {
    for (const time of ['8:30', '1:30:00', '12:00 PM', '08:30']) {
      expect(parseNumber(time), time).toBe(null);
    }
  });
});

describe('parseDate', () => {
  it('reads ISO, and both ambiguous orders on request', () => {
    expect(parseDate('2026-08-04')).toBe('2026-08-04');
    expect(parseDate('04/08/2026')).toBe('2026-04-08');
    expect(parseDate('04/08/2026', { dayFirst: true })).toBe('2026-08-04');
    expect(parseDate('31.12.2025')).toBe('2025-12-31');
    expect(parseDate('8/4/26')).toBe('2026-08-04');
  });

  it('keeps the file’s day-first convention when a cell carries a time', () => {
    // A timestamped export: the time used to push the cell past the
    // day-first reading to the platform's month-first parser.
    expect(parseDate('08/04/2026 10:00', { dayFirst: true })).toBe('2026-04-08');
    expect(parseDate('08/04/2026 10:00', { dayFirst: false })).toBe('2026-08-04');
    expect(parseDate('08/04/2026 10:00:00', { dayFirst: true })).toBe('2026-04-08');
    expect(parseDate('8.4.2026 9:05 pm', { dayFirst: true })).toBe('2026-04-08');
    expect(parseDate('2026-04-08T10:00:00Z')).toBe('2026-04-08');
    expect(parseDate('2026-04-08 10:00')).toBe('2026-04-08');
  });

  it('refuses a date that does not exist, and junk', () => {
    expect(parseDate('2026-02-30')).toBe(null);
    expect(parseDate('not a date')).toBe(null);
    expect(parseDate('')).toBe(null);
  });

  it('only takes a currency this app knows', () => {
    expect(parseCurrency('eur')).toBe('EUR');
    expect(parseCurrency('Dollars')).toBe('');
    expect(parseCurrency('')).toBe('');
  });
});

describe('guessMapping', () => {
  it('matches headers exactly first, then by hint, each column once', () => {
    const header = ['Customer Name', 'E-Mail', 'Phone Number', 'VAT Number', 'Something else'];
    const m = guessMapping(header, CLIENT_FIELDS);
    expect(m.name).toBe(0);
    expect(m.email).toBe(1);
    expect(m.phone).toBe(2);
    expect(m.taxId).toBe(3);
    // No field claims the column it cannot read, and none is claimed twice.
    const used = Object.values(m);
    expect(new Set(used).size).toBe(used.length);
  });

  it('reads a price column as the rate, and a person column as the line', () => {
    // "Price per unit" and "Rate per hour" are prices: `unit` used to claim
    // them first and leave the required rate unmapped, with "150.00" in
    // every Unit box. A timesheet's "Person" is who did the work.
    expect(guessMapping(['Description', 'Quantity', 'Price per unit', 'Total'], LINE_ITEM_FIELDS))
      .toEqual({ name: 0, qty: 1, rate: 2 });
    expect(guessMapping(['Task', 'Hours', 'Rate per hour', 'Unit'], LINE_ITEM_FIELDS))
      .toEqual({ name: 0, qty: 1, rate: 2, unit: 3 });
    expect(guessMapping(['Person', 'Hours', 'Rate', 'Notes'], LINE_ITEM_FIELDS))
      .toEqual({ name: 0, qty: 1, rate: 2, details: 3 });
  });

  it('leaves a field unmapped when nothing resembles it', () => {
    expect(guessMapping(['Name'], CLIENT_FIELDS).notes).toBe(undefined);
  });
});

describe('prepareClients', () => {
  const file = 'Name,Company,Email,Terms\n'
    + 'Maya Chen,Northwind Labs,maya@northwind.example,30\n'
    + 'Sam Ortiz,,sam@bluebird.example,\n';
  const plan = (text, existing = []) => {
    const { header, rows } = parseCsv(text);
    return prepareClients(rows, guessMapping(header, CLIENT_FIELDS), existing);
  };

  it('reads rows into clients, with their billing defaults', () => {
    const result = plan(file);
    expect(result.create).toHaveLength(2);
    expect(result.create[0].data).toMatchObject({
      name: 'Maya Chen', company: 'Northwind Labs', email: 'maya@northwind.example', paymentTermsDays: '30',
    });
    expect(result.errors).toEqual([]);
  });

  it('spots duplicates on email first, then on name', () => {
    const existing = [
      { id: 'c1', name: 'Someone Else', email: 'maya@northwind.example' },
      { id: 'c2', name: 'Sam Ortiz' },
    ];
    const result = plan(file, existing);
    expect(result.create).toEqual([]);
    expect(result.duplicates.map((d) => d.match.id)).toEqual(['c1', 'c2']);
  });

  it('spots a row that names an existing client by their company', () => {
    const existing = [{ id: 'c1', name: 'Maya Chen', company: 'Northwind Labs', email: 'maya@northwind.example' }];
    const rows = [['Northwind Labs', '', 'new@northwind.example']];
    const mapping = { name: 0, company: 1, email: 2 };
    const res = prepareClients(rows, mapping, existing);
    expect(res.create).toEqual([]);
    expect(res.duplicates).toHaveLength(1);
  });

  it('spots a file that repeats itself', () => {
    const result = plan(`${file}Maya Chen,Northwind Labs,maya@northwind.example,30\n`);
    expect(result.create).toHaveLength(2);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].row).toBe(4);
  });

  it('names an unusable row by its number in the file', () => {
    const result = plan('Name,Terms\nMaya,thirty\n,\nSam,14\n');
    expect(result.errors).toEqual([{ row: 2, why: 'payment terms “thirty” is not a number' }]);
    expect(result.create.map((c) => c.data.name)).toEqual(['Sam']);
  });

  it('borrows the company when a row has no contact name', () => {
    const result = plan('Name,Company\n,Northwind Labs\n');
    // The paper prints a name that equals its company once, so keeping both
    // stays faithful to the file without printing it twice.
    expect(result.create[0].data).toMatchObject({ name: 'Northwind Labs', company: 'Northwind Labs' });
  });
});

describe('prepareInvoices', () => {
  const file = 'Number,Client,Date,Due,Total,Paid,Currency\n'
    + 'INV-100,Northwind Labs,2026-05-01,2026-06-01,"1,200.00",200,EUR\n'
    + 'INV-101,Bluebird Cafe,2026-06-11,,480,,\n';
  const clients = [{ id: 'c1', name: 'Maya', company: 'Northwind Labs' }];
  const plan = (text = file, opts = {}) => {
    const { header, rows } = parseCsv(text);
    return prepareInvoices(rows, guessMapping(header, INVOICE_FIELDS), {
      clients, docs: [], currency: 'USD', ...opts,
    });
  };

  it('produces documents whose totals match the file', () => {
    const result = plan();
    expect(result.create).toHaveLength(2);
    const [first, second] = result.create;
    expect(docTotals(first.doc).total).toBe(1200);
    expect(first.paid).toBe(200);
    expect(first.doc).toMatchObject({ number: 'INV-100', currency: 'EUR', status: 'sent', issueDate: '2026-05-01', dueDate: '2026-06-01' });
    expect(first.clientId).toBe('c1');
    // An unmapped currency falls back to the account's own.
    expect(second.doc.currency).toBe('USD');
    expect(second.doc.dueDate).toBe('');
  });

  it('lists the clients it would have to create', () => {
    const result = plan();
    expect(result.newClients.map((c) => c.name)).toEqual(['Bluebird Cafe']);
  });

  it('creates one client for rows that spell them differently on one email', () => {
    const rows = [
      ['INV-1', 'Acme', 'billing@acme.example', '100', '2026-01-05'],
      ['INV-2', 'ACME Inc.', 'BILLING@acme.example', '200', '2026-01-06'],
      ['INV-3', 'Acme  Inc', 'billing@acme.example', '300', '2026-01-07'],
    ];
    const mapping = { number: 0, client: 1, email: 2, total: 3, issueDate: 4 };
    const res = prepareInvoices(rows, mapping, { clients: [] });
    expect([...res.newClients.values()]).toEqual([{ name: 'Acme', email: 'billing@acme.example' }]);
    expect(res.create.map((c) => c.newClient)).toEqual(['acme', 'acme', 'acme']);
  });

  it('refuses junk with the row number, and keeps the good rows', () => {
    const result = plan('Number,Client,Date,Total\n'
      + 'INV-1,A,not a date,100\n'
      + 'INV-2,B,2026-01-01,lots\n'
      + ',C,2026-01-01,100\n'
      + 'INV-4,D,2026-01-01,100\n');
    expect(result.create.map((c) => c.doc.number)).toEqual(['INV-4']);
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect(result.errors[0].why).toContain('is not a date');
    expect(result.errors[2].why).toContain('no invoice number');
  });

  it('refuses a row with nobody to bill', () => {
    // Client is a required field: an invoice with no client is invisible on a
    // statement, so the row is skipped with a reason like any other.
    const result = plan('Number,Client,Date,Total\nINV-1,,2026-01-01,100\nINV-2,B,2026-01-01,100\n');
    expect(result.create.map((c) => c.doc.number)).toEqual(['INV-2']);
    expect(result.errors).toEqual([{ row: 2, why: 'no client' }]);
  });

  it('takes an email that finds a client an earlier row of the file creates', () => {
    const rows = [
      ['INV-1', 'Acme', 'billing@acme.example', '100', '2026-01-05'],
      ['INV-2', '', 'billing@acme.example', '200', '2026-01-06'],
    ];
    const res = prepareInvoices(rows, { number: 0, client: 1, email: 2, total: 3, issueDate: 4 }, { clients: [] });
    expect(res.errors).toEqual([]);
    expect(res.create.map((c) => c.newClient)).toEqual(['acme', 'acme']);
    expect([...res.newClients.values()]).toEqual([{ name: 'Acme', email: 'billing@acme.example' }]);
  });

  it('takes an email that finds a client on file instead of a name', () => {
    const result = plan('Number,Client,Client email,Date,Total\nINV-1,,maya@example.com,2026-01-01,100\n',
      { clients: [{ id: 'c9', name: 'Maya', email: 'maya@example.com' }] });
    expect(result.errors).toEqual([]);
    expect(result.create[0].clientId).toBe('c9');
  });

  it('refuses a total that is not an amount to bill', () => {
    const result = plan('Number,Client,Date,Total,Paid\n'
      + 'INV-1,A,2026-01-01,(120.00),\n'
      + 'INV-2,A,2026-01-01,0,\n'
      + 'INV-3,A,2026-01-01,120,-30\n');
    expect(result.create).toEqual([]);
    expect(result.errors.map((e) => e.why)).toEqual([
      'total “(120.00)” is not an amount to bill',
      'total “0” is not an amount to bill',
      'amount paid “-30” is less than nothing',
    ]);
  });

  it('refuses a row that says more was paid than was billed', () => {
    const result = plan('Number,Client,Date,Total,Paid\nINV-1,A,2026-01-01,100,150\n');
    expect(result.create).toEqual([]);
    expect(result.errors[0].why).toContain('more than the total');
  });

  it('flags numbers the account already uses', () => {
    const result = plan(file, { docs: [{ number: 'inv-100' }] });
    expect(result.clashes).toEqual(['INV-100']);
  });

  it('flags a number the file itself repeats', () => {
    const result = plan('Number,Client,Date,Total\n'
      + 'INV-1,A,2026-01-01,100\n'
      + 'inv-1,A,2026-01-02,100\n');
    expect(result.create).toHaveLength(2);
    expect(result.clashes).toEqual(['inv-1']);
  });

  it('reads day-first dates when told to', () => {
    const result = plan('Number,Client,Date,Total\nINV-1,A,03/04/2026,100\n', { dayFirst: true });
    expect(result.create[0].doc.issueDate).toBe('2026-04-03');
  });

  it('summarises what will happen in one line', () => {
    expect(importSummary(plan(), 'invoices')).toBe('2 invoices to add · 1 new client');
    const { header, rows } = parseCsv('Name\nMaya\n\n');
    expect(importSummary(prepareClients(rows, guessMapping(header, CLIENT_FIELDS), []), 'clients'))
      .toBe('1 client to add');
  });
});

describe('prepareLineItems', () => {
  const mapOf = (header) => guessMapping(header, LINE_ITEM_FIELDS);

  it('maps a timekeeper sheet: person, hours, narrative, and rate', () => {
    const { header, rows } = parseCsv(
      'Timekeeper,Hours,Description,Rate\n'
      + 'J. Smith,3.5,"Drafted the motion; reviewed exhibits",300\n'
      + 'A. Jones,1,Call with opposing counsel,250\n');
    const mapping = mapOf(header);
    // The person lands on the line, the narrative under it.
    expect(mapping).toEqual({ name: 0, details: 2, qty: 1, rate: 3 });
    const plan = prepareLineItems(rows, mapping);
    expect(plan.errors).toEqual([]);
    expect(plan.items.map(({ data }) => data)).toEqual([
      { name: 'J. Smith', qty: 3.5, rate: 300, details: 'Drafted the motion; reviewed exhibits' },
      { name: 'A. Jones', qty: 1, rate: 250, details: 'Call with opposing counsel' },
    ]);
  });

  it('maps a plain task sheet, description first', () => {
    const { header } = parseCsv('Description,Qty,Unit,Unit price\nDesign,2,days,800\n');
    expect(mapOf(header)).toEqual({ name: 0, qty: 1, unit: 2, rate: 3 });
  });

  it('defaults a blank quantity to 1 and leaves a blank rate for the price list', () => {
    const rows = [['Studio time', '', '']];
    const plan = prepareLineItems(rows, { name: 0, qty: 1, rate: 2 });
    expect(plan.items[0].data).toEqual({ name: 'Studio time', qty: 1, rate: '' });
  });

  it('refuses junk numbers per row, with the file’s own row number', () => {
    const rows = [
      ['Fine', '2', '100'],
      ['Bad qty', 'three', '100'],
      ['Bad rate', '1', 'call me'],
      ['Negative rate', '1', '-50'],
    ];
    const plan = prepareLineItems(rows, { name: 0, qty: 1, rate: 2 });
    expect(plan.items).toHaveLength(1);
    expect(plan.errors.map((e) => e.row)).toEqual([3, 4, 5]);
  });

  it('lets a credit line through: a negative quantity is real billing', () => {
    const plan = prepareLineItems([['Credit for May', '-1', '200']], { name: 0, qty: 1, rate: 2 });
    expect(plan.errors).toEqual([]);
    expect(plan.items[0].data.qty).toBe(-1);
  });

  it('skips a row with no description, silently when the row is empty', () => {
    const plan = prepareLineItems([
      ['', '', ''],           // an empty spreadsheet row is not an error
      ['', '2', '100'],       // money with no name is
    ], { name: 0, qty: 1, rate: 2 });
    expect(plan.items).toEqual([]);
    expect(plan.errors).toEqual([{ row: 3, why: 'no description' }]);
  });

  it('bounds the unit like the editor’s own box, and drops empty extras', () => {
    const plan = prepareLineItems([['Work', '1', '10', 'x'.repeat(40), '']],
      { name: 0, qty: 1, rate: 2, unit: 3, details: 4 });
    const { data } = plan.items[0];
    expect(data.unit).toHaveLength(24);
    expect('details' in data).toBe(false);
  });

  it('reads money the way people write it', () => {
    const plan = prepareLineItems([['Work', '1.234,5', '$1,200.50']], { name: 0, qty: 1, rate: 2 });
    expect(plan.items[0].data).toEqual({ name: 'Work', qty: 1234.5, rate: 1200.5 });
  });
});
