import { describe, it, expect } from 'vitest';
import { csvEscape, paymentRows, paymentsCsv } from '../src/lib/acct-csv.js';

const clients = [{ id: 'c1', name: 'Acme, Inc.' }];
const docs = [
  {
    kind: 'invoice', number: 'INV-0001', clientId: 'c1', currency: 'USD', status: 'sent',
    payments: [
      { date: '2026-07-01', amount: 500, method: 'Bank transfer' },
      { date: '2026-07-15', amount: 250.5, method: '' },
    ],
  },
  { kind: 'invoice', number: 'INV-0002', clientId: 'c1', currency: 'USD', status: 'void', payments: [{ date: '2026-07-02', amount: 99 }] },
  { kind: 'quote', number: 'EST-0001', clientId: 'c1', currency: 'USD', status: 'sent', payments: [] },
  { kind: 'invoice', number: 'INV-0003', clientId: 'missing', currency: 'EUR', status: 'sent', payments: [{ date: '2026-06-30', amount: 80 }] },
];

describe('csvEscape', () => {
  it('quotes fields containing commas, quotes, or newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralizes leading formula characters (CSV injection)', () => {
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvEscape('+1234')).toBe("'+1234");
    expect(csvEscape('-cmd')).toBe("'-cmd");
    expect(csvEscape('@sum')).toBe("'@sum");
  });

  it('leaves ordinary exported values untouched', () => {
    expect(csvEscape('2026-08-04')).toBe('2026-08-04');
    expect(csvEscape('1240.00')).toBe('1240.00');
    expect(csvEscape('INV-0001 · Acme')).toBe('INV-0001 · Acme');
  });

  it('lets a negative amount through as a number', () => {
    expect(csvEscape('-250.00')).toBe('-250.00');
    expect(csvEscape('-250')).toBe('-250');
    // Still guarded: these are not numbers.
    expect(csvEscape('-250.00.1')).toBe("'-250.00.1");
    expect(csvEscape('-2+3')).toBe("'-2+3");
  });
});

describe('paymentRows', () => {
  it('emits one income row per payment, oldest first', () => {
    const rows = paymentRows(docs, clients);
    expect(rows.map((r) => r.date)).toEqual(['2026-06-30', '2026-07-01', '2026-07-15']);
    expect(rows[1]).toMatchObject({ type: 'income', amount: 500, currency: 'USD', category: 'Freelance' });
  });

  it('skips void invoices and quotes', () => {
    expect(paymentRows(docs, clients).some((r) => r.note.includes('INV-0002'))).toBe(false);
    expect(paymentRows(docs, clients).some((r) => r.note.includes('EST-'))).toBe(false);
  });

  it('notes the invoice number, client, and method; tolerates a deleted client', () => {
    const rows = paymentRows(docs, clients);
    expect(rows[1].note).toBe('INV-0001 · Acme, Inc. · Bank transfer');
    expect(rows[0].note).toBe('INV-0003');
  });

  it('identifies a client by company when there is no name, and skips neither-nor', () => {
    // A restored backup can carry a client with only an id; the note used to
    // interpolate the missing name as the literal string "undefined".
    const roster = [{ id: 'c1', company: 'Northwind Labs' }, { id: 'c2' }];
    const paid = (clientId, number) => ({
      kind: 'invoice', status: 'paid', number, clientId, currency: 'USD',
      payments: [{ date: '2026-07-01', amount: 100, method: 'Card' }],
    });
    const rows = paymentRows([paid('c1', 'INV-0009'), paid('c2', 'INV-0010')], roster);
    expect(rows.map((r) => r.note)).toEqual([
      'INV-0009 · Northwind Labs · Card',
      'INV-0010 · Card',
    ]);
  });
});

describe('paymentsCsv', () => {
  it('produces a header plus escaped data rows', () => {
    const csv = paymentsCsv(docs, clients);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('Date,Type,Amount,Currency,Category,Note');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain('"INV-0001 · Acme, Inc. · Bank transfer"');
    expect(lines[2]).toContain('500.00');
  });
});

describe('refund rows', () => {
  const withRefund = [{
    kind: 'invoice',
    number: 'INV-0004',
    clientId: 'c1',
    currency: 'USD',
    status: 'sent',
    payments: [
      { date: '2026-03-01', amount: 900, method: 'Card' },
      { date: '2026-04-02', amount: -250, method: 'Card' },
    ],
  }];
  const clients = [{ id: 'c1', name: 'Maya Chen' }];

  it('exports a refund as negative income, not as a second earning', () => {
    const rows = paymentRows(withRefund, clients);
    expect(rows.map((r) => [r.type, r.amount])).toEqual([['income', 900], ['income', -250]]);
    expect(rows[1].note).toBe('Refund · INV-0004 · Maya Chen · Card');
  });

  it('keeps the sign through the CSV so the imported total nets out', () => {
    const csv = paymentsCsv(withRefund, clients);
    expect(csv).toContain('2026-03-01,income,900.00,USD');
    expect(csv).toContain('2026-04-02,income,-250.00,USD');
    // The formula guard must not turn the amount into text: the app reading
    // this file would fail to parse it.
    expect(csv).not.toContain("'-250.00");
  });
});

describe('the base-currency columns', () => {
  const docs = [
    {
      kind: 'invoice', number: 'INV-1', currency: 'EUR', fxRate: 1.1, clientId: 'c1',
      issueDate: '2026-02-01', status: 'sent',
      items: [{ qty: 1, rate: 1000 }],
      payments: [{ id: 'p1', date: '2026-03-01', amount: 500 }],
    },
    {
      kind: 'invoice', number: 'INV-2', currency: 'EUR', clientId: 'c1',
      issueDate: '2026-02-01', status: 'sent',
      items: [{ qty: 1, rate: 100 }],
      payments: [{ id: 'p2', date: '2026-03-02', amount: 100 }],
    },
  ];
  const clients = [{ id: 'c1', name: 'Maya', company: 'Northwind' }];

  it('adds a converted amount when a rate is stored', () => {
    const csv = paymentsCsv(docs, clients, { baseCurrency: 'USD' });
    const [head, first, second] = csv.trim().split('\n');
    expect(head.endsWith('Base amount,Base currency')).toBe(true);
    expect(first).toContain('550.00,USD');
    // The payment with no rate leaves the columns empty rather than guessing.
    expect(second.endsWith(',,')).toBe(true);
  });

  it('leaves a single-currency export exactly as it was', () => {
    const home = [{ ...docs[0], currency: 'USD', fxRate: null }];
    const csv = paymentsCsv(home, clients, { baseCurrency: 'USD' });
    expect(csv.split('\n')[0]).toBe('Date,Type,Amount,Currency,Category,Note');
  });

  it('leaves the export alone when no base currency is given', () => {
    expect(paymentsCsv(docs, clients).split('\n')[0]).toBe('Date,Type,Amount,Currency,Category,Note');
  });
});
