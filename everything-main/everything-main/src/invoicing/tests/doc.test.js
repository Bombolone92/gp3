import { describe, it, expect } from 'vitest';
import {
  docStatus, formatDocNumber, isOpenInvoice, invoiceFromQuote, clientTotals, matchesClientFilter,
  settingsTaxes, defaultTaxes, isWrittenOff, dueDateFor,
  billingDefaults, termDays, MAX_TERM_DAYS,
} from '../src/lib/doc.js';
import { addDays } from '../src/lib/dates.js';

const TODAY = '2026-08-04';

const invoice = (over = {}) => ({
  kind: 'invoice',
  status: 'sent',
  issueDate: '2026-07-20',
  dueDate: '2026-08-20',
  items: [{ qty: 1, rate: 100 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  payments: [],
  ...over,
});

const quote = (over = {}) => ({
  kind: 'quote',
  status: 'sent',
  issueDate: '2026-07-20',
  validUntil: '2026-08-20',
  items: [{ qty: 1, rate: 100 }],
  payments: [],
  ...over,
});

describe('docStatus for invoices', () => {
  it('reports stored draft and void directly', () => {
    expect(docStatus(invoice({ status: 'draft' }), TODAY)).toBe('draft');
    expect(docStatus(invoice({ status: 'void' }), TODAY)).toBe('void');
  });

  it('derives paid from payments covering the total', () => {
    expect(docStatus(invoice({ payments: [{ amount: 100 }] }), TODAY)).toBe('paid');
  });

  it('derives partial from payments below the total', () => {
    expect(docStatus(invoice({ payments: [{ amount: 40 }] }), TODAY)).toBe('partial');
  });

  it('derives overdue after the due date, including for partly paid invoices', () => {
    expect(docStatus(invoice({ dueDate: '2026-08-03' }), TODAY)).toBe('overdue');
    expect(docStatus(invoice({ dueDate: '2026-08-03', payments: [{ amount: 40 }] }), TODAY)).toBe('overdue');
  });

  it('is not overdue on the due date itself', () => {
    expect(docStatus(invoice({ dueDate: TODAY }), TODAY)).toBe('sent');
  });

  it('paid beats overdue', () => {
    expect(docStatus(invoice({ dueDate: '2026-01-01', payments: [{ amount: 100 }] }), TODAY)).toBe('paid');
  });

  it('settles an invoice that asks for nothing rather than chasing it forever', () => {
    const free = invoice({ dueDate: '2026-01-01', items: [{ qty: 1, rate: 0 }] });
    expect(docStatus(free, TODAY)).toBe('paid');
    expect(isOpenInvoice(free, TODAY)).toBe(false);
    // Discounted down to nothing counts the same way.
    const comped = invoice({
      dueDate: '2026-01-01', discountType: 'percent', discountValue: 100,
    });
    expect(docStatus(comped, TODAY)).toBe('paid');
  });

  it('leaves a zero-total draft a draft', () => {
    expect(docStatus(invoice({ status: 'draft', items: [{ qty: 1, rate: 0 }] }), TODAY)).toBe('draft');
  });
});

describe('docStatus without a date', () => {
  it('reads what the document says about itself, never what the clock would', () => {
    // The public share page is a static file, so it asks without a date.
    expect(docStatus(invoice({ dueDate: '2020-01-01' }))).toBe('sent');
    expect(docStatus(invoice({ dueDate: '2020-01-01', payments: [{ amount: 40 }] }))).toBe('partial');
    expect(docStatus(invoice({ payments: [{ amount: 100 }] }))).toBe('paid');
    expect(docStatus(invoice({ status: 'void' }))).toBe('void');
    expect(docStatus(quote({ validUntil: '2020-01-01' }))).toBe('sent');
    expect(docStatus(quote({ status: 'declined' }))).toBe('declined');
  });
});

describe('docStatus for quotes', () => {
  it('reports stored draft, accepted, and declined directly', () => {
    expect(docStatus(quote({ status: 'draft' }), TODAY)).toBe('draft');
    expect(docStatus(quote({ status: 'accepted' }), TODAY)).toBe('accepted');
    expect(docStatus(quote({ status: 'declined' }), TODAY)).toBe('declined');
  });

  it('derives expired from the valid-until date', () => {
    expect(docStatus(quote({ validUntil: '2026-08-03' }), TODAY)).toBe('expired');
    expect(docStatus(quote({ validUntil: TODAY }), TODAY)).toBe('sent');
  });

  it('reads as invoiced once converted, whatever the stored status', () => {
    expect(docStatus(quote({ status: 'accepted', invoiceId: 'x' }), TODAY)).toBe('invoiced');
    expect(docStatus(quote({ status: 'sent', invoiceId: 'x' }), TODAY)).toBe('invoiced');
  });
});

describe('isOpenInvoice', () => {
  it('counts sent, partial, and overdue invoices', () => {
    expect(isOpenInvoice(invoice(), TODAY)).toBe(true);
    expect(isOpenInvoice(invoice({ payments: [{ amount: 40 }] }), TODAY)).toBe(true);
    expect(isOpenInvoice(invoice({ dueDate: '2026-01-01' }), TODAY)).toBe(true);
  });

  it('excludes drafts, paid, void, and quotes', () => {
    expect(isOpenInvoice(invoice({ status: 'draft' }), TODAY)).toBe(false);
    expect(isOpenInvoice(invoice({ status: 'void' }), TODAY)).toBe(false);
    expect(isOpenInvoice(invoice({ payments: [{ amount: 100 }] }), TODAY)).toBe(false);
    expect(isOpenInvoice(quote(), TODAY)).toBe(false);
  });
});

describe('formatDocNumber', () => {
  it('pads to four digits with the prefix', () => {
    expect(formatDocNumber('INV-', 7)).toBe('INV-0007');
    expect(formatDocNumber('EST-', 123)).toBe('EST-0123');
  });

  it('keeps wide numbers whole and survives bad input', () => {
    expect(formatDocNumber('INV-', 12345)).toBe('INV-12345');
    expect(formatDocNumber('INV-', 0)).toBe('INV-0001');
    expect(formatDocNumber(undefined, NaN)).toBe('0001');
  });

  it('resolves a {YYYY} token from the issue date', () => {
    expect(formatDocNumber('INV-{YYYY}-', 7, '2026-03-01')).toBe('INV-2026-0007');
    expect(formatDocNumber('INV-{YYYY}-', 7, '2025-12-31')).toBe('INV-2025-0007');
    expect(formatDocNumber('{YYYY}/', 12, '2026-06-15')).toBe('2026/0012');
  });

  it('resolves {YYYY} to the current year when no date is given', () => {
    const year = String(new Date().getFullYear());
    expect(formatDocNumber('INV-{YYYY}-', 1)).toBe(`INV-${year}-0001`);
  });
});

describe('settingsTaxes and defaultTaxes', () => {
  it('prefers the named list and falls back to the legacy pair', () => {
    expect(settingsTaxes({ taxes: [{ label: 'GST', rate: 5 }, { label: 'PST', rate: 7 }] }))
      .toEqual([{ label: 'GST', rate: 5 }, { label: 'PST', rate: 7 }]);
    expect(settingsTaxes({ taxes: [], taxRate: 8.5, taxLabel: 'VAT' }))
      .toEqual([{ label: 'VAT', rate: 8.5 }]);
    expect(settingsTaxes({ taxes: [], taxRate: 0 })).toEqual([]);
  });

  it('drops zero-rate rows rather than printing empty tax lines', () => {
    expect(settingsTaxes({ taxes: [{ label: 'GST', rate: 5 }, { label: '', rate: 0 }] }))
      .toEqual([{ label: 'GST', rate: 5 }]);
  });

  it("replaces the whole list with a client's simple override", () => {
    const settings = { taxes: [{ label: 'GST', rate: 5 }, { label: 'PST', rate: 7 }], taxLabel: 'Tax' };
    expect(defaultTaxes(settings, { taxRate: 10 })).toEqual([{ label: 'Tax', rate: 10 }]);
    // Zero is a real answer: a tax-exempt client starts with no taxes at all.
    expect(defaultTaxes(settings, { taxRate: 0 })).toEqual([]);
    // An empty override inherits the list.
    expect(defaultTaxes(settings, { taxRate: '' })).toEqual(settings.taxes);
    expect(defaultTaxes(settings, null)).toEqual(settings.taxes);
  });
});

describe('invoiceFromQuote', () => {
  const q = quote({
    id: 'q1',
    clientId: 'c1',
    currency: 'EUR',
    taxRate: 19,
    taxInclusive: true,
    discountType: 'percent',
    discountValue: 5,
    reference: 'PO 2026-118',
    deposit: { type: 'percent', value: 30 },
    notes: 'Thanks!',
    number: 'EST-0002',
    taxNote: 'none',
    fxRate: 1.09,
  });
  const inv = invoiceFromQuote(q, {
    id: 'i1', number: 'INV-0009', issueDate: TODAY, dueDate: '2026-08-18',
  });

  it('carries over the billing terms and links back to the quote', () => {
    expect(inv).toMatchObject({
      kind: 'invoice', id: 'i1', number: 'INV-0009', clientId: 'c1',
      currency: 'EUR', taxRate: 19, taxInclusive: true, discountValue: 5, quoteId: 'q1',
      reference: 'PO 2026-118', status: 'draft', payments: [],
    });
  });

  it('carries the estimate’s own tax note and exchange rate', () => {
    // 'none' is the document saying it carries no such sentence; losing it
    // let the account's default wording print on the invoice instead.
    expect(inv.taxNote).toBe('none');
    expect(inv.fxRate).toBe(1.09);
  });

  it('leaves an inherited tax note inheriting, and adds no rate that was not there', () => {
    const plain = invoiceFromQuote(quote({ id: 'q2' }), {
      id: 'i2', number: 'INV-0010', issueDate: TODAY, dueDate: '2026-08-18',
    });
    expect(plain.taxNote).toBe('');
    expect('fxRate' in plain).toBe(false);
  });

  it('leaves the reference empty when the quote had none', () => {
    expect(invoiceFromQuote(quote({ id: 'q2' }), {
      id: 'i2', number: 'INV-0010', issueDate: TODAY, dueDate: '2026-08-18',
    }).reference).toBe('');
  });

  it('deep-copies line items so editing the invoice never mutates the quote', () => {
    inv.items[0].rate = 999;
    expect(q.items[0].rate).toBe(100);
  });

  it('hands the requested deposit to the invoice, as its own copy', () => {
    expect(inv.deposit).toEqual({ type: 'percent', value: 30 });
    inv.deposit.value = 50;
    expect(q.deposit.value).toBe(30);
  });
});

describe('clientTotals', () => {
  const inv = (over) => invoice(over);
  it('splits billed, collected, and open per currency', () => {
    const docs = [
      inv({ items: [{ qty: 1, rate: 1000 }], payments: [{ amount: 400 }] }),
      inv({ currency: 'EUR', items: [{ qty: 1, rate: 500 }], payments: [{ amount: 500 }] }),
    ];
    docs[0].currency = 'USD';
    expect(clientTotals(docs, TODAY)).toEqual({
      billed: { USD: 1000, EUR: 500 },
      collected: { USD: 400, EUR: 500 },
      open: { USD: 600 },
    });
  });

  it('leaves drafts out of billed but keeps their payments honest', () => {
    const docs = [inv({ status: 'draft', currency: 'USD', items: [{ qty: 1, rate: 300 }] })];
    expect(clientTotals(docs, TODAY)).toEqual({ billed: {}, collected: {}, open: {} });
  });

  it('ignores void invoices and estimates', () => {
    const docs = [
      inv({ status: 'void', currency: 'USD', payments: [{ amount: 100 }] }),
      quote({ currency: 'USD' }),
    ];
    expect(clientTotals(docs, TODAY)).toEqual({ billed: {}, collected: {}, open: {} });
  });

  it('counts an overdue invoice as open', () => {
    const docs = [inv({ currency: 'USD', dueDate: '2026-07-01', items: [{ qty: 1, rate: 250 }] })];
    expect(clientTotals(docs, TODAY).open).toEqual({ USD: 250 });
  });
});

describe('matchesClientFilter', () => {
  const paid = invoice({ payments: [{ amount: 100 }] });
  const open = invoice({ dueDate: '2026-09-01' });
  const late = invoice({ dueDate: '2026-07-01' });
  const draft = invoice({ status: 'draft' });
  const est = quote();

  it('passes everything under "all"', () => {
    for (const d of [paid, open, late, draft, est]) {
      expect(matchesClientFilter(d, 'all', TODAY)).toBe(true);
    }
  });

  it('treats sent, partly paid, and overdue invoices as open', () => {
    expect(matchesClientFilter(open, 'open', TODAY)).toBe(true);
    expect(matchesClientFilter(late, 'open', TODAY)).toBe(true);
    expect(matchesClientFilter(paid, 'open', TODAY)).toBe(false);
    expect(matchesClientFilter(draft, 'open', TODAY)).toBe(false);
    expect(matchesClientFilter(est, 'open', TODAY)).toBe(false);
  });

  it('keeps paid, drafts, and estimates apart', () => {
    expect(matchesClientFilter(paid, 'paid', TODAY)).toBe(true);
    expect(matchesClientFilter(late, 'paid', TODAY)).toBe(false);
    expect(matchesClientFilter(draft, 'draft', TODAY)).toBe(true);
    expect(matchesClientFilter(est, 'quote', TODAY)).toBe(true);
    expect(matchesClientFilter(paid, 'quote', TODAY)).toBe(false);
  });
});

describe('docStatus after a refund', () => {
  it('turns a paid invoice back into a partly paid one', () => {
    const d = invoice({ payments: [{ amount: 100 }] });
    expect(docStatus(d, TODAY)).toBe('paid');
    d.payments.push({ amount: -40 });
    expect(docStatus(d, TODAY)).toBe('partial');
  });

  it('reads a fully refunded invoice as unpaid again', () => {
    const d = invoice({ payments: [{ amount: 100 }, { amount: -100 }] });
    expect(docStatus(d, TODAY)).toBe('sent');
    expect(isOpenInvoice(d, TODAY)).toBe(true);
  });

  it('keeps a fully refunded, past-due invoice overdue', () => {
    const d = invoice({ dueDate: '2026-07-01', payments: [{ amount: 100 }, { amount: -100 }] });
    expect(docStatus(d, TODAY)).toBe('overdue');
  });

  it('leaves a void invoice void whatever flows back', () => {
    const d = invoice({ status: 'void', payments: [{ amount: 100 }, { amount: -100 }] });
    expect(docStatus(d, TODAY)).toBe('void');
  });
});

describe('termDays', () => {
  it('keeps a real number of days, including none at all', () => {
    expect(termDays(30)).toBe(30);
    expect(termDays('45')).toBe(45);
    expect(termDays(0)).toBe(0);
    expect(termDays(14.6)).toBe(15);
  });

  it('falls back only when there is no usable value', () => {
    expect(termDays('')).toBe(14);
    expect(termDays(null, 30)).toBe(30);
    expect(termDays('abc', 7)).toBe(7);
    expect(termDays(-5)).toBe(0);
  });

  it('caps terms at a length a date can survive', () => {
    expect(termDays(999999999)).toBe(MAX_TERM_DAYS);
    // Uncapped, this is what used to reach the paper as a due date.
    expect(addDays('2026-08-04', 999999999)).toBe('NaN-NaN-NaN');
    expect(addDays('2026-08-04', termDays(999999999))).toBe('2036-08-01');
  });
});

describe('billingDefaults', () => {
  const settings = { currency: 'USD', taxRate: 8.5, paymentTermsDays: 14, defaultNotes: 'Thanks!' };

  it('uses the global defaults when a client has no overrides', () => {
    expect(billingDefaults(settings, { id: 'c1', name: 'Maya' })).toEqual({
      currency: 'USD', taxRate: 8.5, paymentTermsDays: 14, notes: 'Thanks!',
    });
    expect(billingDefaults(settings, null)).toEqual({
      currency: 'USD', taxRate: 8.5, paymentTermsDays: 14, notes: 'Thanks!',
    });
  });

  it('applies each override the client actually has', () => {
    expect(billingDefaults(settings, { currency: 'EUR', paymentTermsDays: 30 })).toEqual({
      currency: 'EUR', taxRate: 8.5, paymentTermsDays: 30, notes: 'Thanks!',
    });
    expect(billingDefaults(settings, { notes: 'Net 30, wire only.' }).notes).toBe('Net 30, wire only.');
  });

  it('keeps a tax-exempt client at zero rather than inheriting', () => {
    expect(billingDefaults(settings, { taxRate: 0 }).taxRate).toBe(0);
    expect(billingDefaults(settings, { taxRate: '' }).taxRate).toBe(8.5);
    expect(billingDefaults(settings, { paymentTermsDays: 0 }).paymentTermsDays).toBe(0);
  });

  it('ignores blank and unusable overrides', () => {
    expect(billingDefaults(settings, {
      currency: '   ', taxRate: 'abc', paymentTermsDays: null, notes: '   ',
    })).toEqual({ currency: 'USD', taxRate: 8.5, paymentTermsDays: 14, notes: 'Thanks!' });
  });

  it('clamps to sane values and falls back with no settings at all', () => {
    expect(billingDefaults(settings, { taxRate: 400 }).taxRate).toBe(100);
    expect(billingDefaults(settings, { paymentTermsDays: -5 }).paymentTermsDays).toBe(0);
    expect(billingDefaults(settings, { paymentTermsDays: 30.6 }).paymentTermsDays).toBe(31);
    expect(billingDefaults(settings, { paymentTermsDays: 999999 }).paymentTermsDays).toBe(MAX_TERM_DAYS);
    expect(billingDefaults({ ...settings, paymentTermsDays: 999999 }, null).paymentTermsDays)
      .toBe(MAX_TERM_DAYS);
    expect(billingDefaults(null, null)).toEqual({
      currency: 'USD', taxRate: 0, paymentTermsDays: 14, notes: '',
    });
  });
});

describe('written-off invoices', () => {
  const written = (over = {}) => invoice({
    writeOff: { date: '2026-08-01', reason: 'Client dissolved' }, ...over,
  });

  it('derives its own status, whatever the due date says', () => {
    expect(docStatus(written(), TODAY)).toBe('writtenOff');
    // An overdue one reads as written off, not overdue: nobody is chasing it.
    expect(docStatus(written({ dueDate: '2026-07-01' }), TODAY)).toBe('writtenOff');
    expect(docStatus(written({ payments: [{ amount: 40 }] }), TODAY)).toBe('writtenOff');
  });

  it('reads as paid when the money turned up after all', () => {
    expect(docStatus(written({ payments: [{ amount: 100 }] }), TODAY)).toBe('paid');
  });

  it('is not derived from a stray value on the document', () => {
    expect(isWrittenOff(invoice())).toBe(false);
    expect(isWrittenOff(invoice({ writeOff: 'yes' }))).toBe(false);
    expect(docStatus(invoice({ writeOff: null }), TODAY)).toBe('sent');
  });

  it('leaves a draft and a void invoice reading as they did', () => {
    expect(docStatus(written({ status: 'draft' }), TODAY)).toBe('draft');
    expect(docStatus(written({ status: 'void' }), TODAY)).toBe('void');
  });

  it('stops being open money', () => {
    expect(isOpenInvoice(invoice(), TODAY)).toBe(true);
    expect(isOpenInvoice(written(), TODAY)).toBe(false);
  });

  it('stays billed to the client while leaving their open balance', () => {
    const totals = clientTotals([written({ currency: 'USD', payments: [{ amount: 30 }] })], TODAY);
    expect(totals.billed).toEqual({ USD: 100 });
    expect(totals.collected).toEqual({ USD: 30 });
    expect(totals.open).toEqual({});
  });

  it('has its own filter', () => {
    expect(matchesClientFilter(written(), 'writtenOff', TODAY)).toBe(true);
    expect(matchesClientFilter(written(), 'open', TODAY)).toBe(false);
    expect(matchesClientFilter(invoice(), 'writtenOff', TODAY)).toBe(false);
  });
});

describe('status against a payment schedule', () => {
  const plan = (over = {}) => invoice({
    dueDate: '2026-12-01',
    items: [{ qty: 1, rate: 1000 }],
    schedule: [
      { id: 'a', label: 'On signing', dueDate: '2026-07-01', type: 'percent', value: 50 },
      { id: 'b', label: 'On delivery', dueDate: '2026-12-01', type: 'percent', value: 50 },
    ],
    ...over,
  });

  it('is overdue as soon as the earliest unpaid part is, not the last one', () => {
    // The invoice's own due date is months away; the first installment is not.
    expect(docStatus(invoice({ dueDate: '2026-12-01' }), TODAY)).toBe('sent');
    expect(docStatus(plan(), TODAY)).toBe('overdue');
  });

  it('stops being overdue once that part is covered', () => {
    expect(docStatus(plan({ payments: [{ amount: 500 }] }), TODAY)).toBe('partial');
    expect(dueDateFor(plan({ payments: [{ amount: 500 }] }))).toBe('2026-12-01');
  });

  it('measures against the earliest open part', () => {
    expect(dueDateFor(plan())).toBe('2026-07-01');
    // Everything settled but a late fee added afterwards: the last date holds.
    const settled = plan({ payments: [{ amount: 1000 }], items: [{ qty: 1, rate: 1000 }, { qty: 1, rate: 40 }] });
    expect(dueDateFor(settled)).toBe('2026-12-01');
  });

  it('leaves an invoice without a schedule reading exactly as before', () => {
    expect(dueDateFor(invoice({ dueDate: '2026-08-20' }))).toBe('2026-08-20');
    expect(dueDateFor(invoice({ dueDate: '' }))).toBe('');
  });

  it('still reads paid, void, and written off first', () => {
    expect(docStatus(plan({ payments: [{ amount: 1000 }] }), TODAY)).toBe('paid');
    expect(docStatus(plan({ status: 'void' }), TODAY)).toBe('void');
    expect(docStatus(plan({ writeOff: { date: '2026-08-01' } }), TODAY)).toBe('writtenOff');
  });

  it('carries a quote’s schedule onto the invoice it becomes', () => {
    const q = quote({ schedule: [{ id: 'a', dueDate: '2026-09-01', type: 'percent', value: 40 }] });
    const inv = invoiceFromQuote(q, { id: 'i1', number: 'INV-1', issueDate: '2026-08-04', dueDate: '2026-08-18' });
    expect(inv.schedule).toEqual(q.schedule);
    expect(inv.schedule).not.toBe(q.schedule);
    expect(inv.schedule[0]).not.toBe(q.schedule[0]);
  });
});
