import { describe, it, expect } from 'vitest';
import { receiptDoc } from '../src/lib/receipt-doc.js';
import { formatMoney } from '../src/lib/money.js';

/** The app's own formatter, so assertions don't depend on the test locale. */
const usd = (n) => formatMoney(n, 'USD');

const settings = {
  storeName: 'Corner Roast Café',
  address: '12 Market Lane\nUnit 4',
  receiptFooter: 'Thanks, see you tomorrow',
};

const sale = {
  number: 1042,
  date: '2026-08-04',
  at: Date.UTC(2026, 7, 4, 14, 30),
  currency: 'USD',
  pricesIncludeTax: false,
  type: 'sale',
  lines: [
    {
      productId: 'p1', name: 'Latte', unitPrice: 5.9, qty: 2, taxRate: 9.5, taxName: 'Prepared food',
      options: [{ group: 'Size', name: 'Large', delta: 0.7 }, { group: 'Milk', name: 'Oat', delta: 0.6 }],
      subtotal: 11.8, discountAmount: 1.18, tax: 1.01, total: 11.63,
    },
    {
      productId: 'p2', name: 'Croissant', unitPrice: 3.6, qty: 1, taxRate: 9.5, taxName: 'Prepared food',
      subtotal: 3.6, discountAmount: 0.36, tax: 0.31, total: 3.55,
    },
  ],
  itemCount: 3,
  subtotal: 15.4,
  discountTotal: 1.54,
  taxTotal: 1.32,
  taxes: [{ rate: 9.5, name: 'Prepared food', taxable: 13.86, tax: 1.32 }],
  total: 15.18,
  payments: [{ method: 'cash', amount: 15.18, tendered: 20, change: 4.82 }],
  note: 'Corner table',
};

describe('receiptDoc', () => {
  it('describes a sale the way the paper slip reads', () => {
    const doc = receiptDoc(sale, settings);
    expect(doc.storeName).toBe('Corner Roast Café');
    expect(doc.address).toBe('12 Market Lane\nUnit 4');
    expect(doc.refund).toBe(false);
    expect(doc.kind).toBeNull();
    expect(doc.voided).toBe(false);
    expect(doc.meta[0]).toBe('Receipt #1042');
    expect(doc.meta).toHaveLength(2);
    expect(doc.footer).toBe('Thanks, see you tomorrow');
    expect(doc.note).toBe('Corner table');
  });

  it('formats every amount in the receipt\'s own currency', () => {
    const doc = receiptDoc({ ...sale, currency: 'EUR' }, settings);
    expect(doc.totals.at(-1).value).toMatch(/15[.,]18/);
    expect(doc.totals.at(-1).value).not.toContain('$');
  });

  it('puts options, unit price, and discount under their item', () => {
    const doc = receiptDoc(sale, settings);
    expect(doc.items[0]).toMatchObject({ qty: '2×', name: 'Latte', amount: usd(11.8) });
    expect(doc.items[0].subs.map((s) => s.text)).toEqual([
      'Large · Oat', `${usd(5.9)} each`, `Discount −${usd(1.18)}`,
    ]);
    // One of one needs no "each" line.
    expect(doc.items[1].subs.map((s) => s.kind)).toEqual(['discount']);
  });

  it('lists tenders and change', () => {
    const doc = receiptDoc(sale, settings);
    expect(doc.payments).toEqual([
      { label: 'Cash', value: usd(20) },
      { label: 'Change', value: usd(4.82) },
    ]);
  });

  it('shows each tender of a split sale', () => {
    const doc = receiptDoc({
      ...sale,
      payments: [{ method: 'cash', amount: 10 }, { method: 'card', amount: 5.18 }],
    }, settings);
    expect(doc.payments).toEqual([
      { label: 'Cash', value: usd(10) },
      { label: 'Card', value: usd(5.18) },
    ]);
  });

  it('reads a pre-split receipt the same way', () => {
    const { payments, ...legacy } = sale;
    const doc = receiptDoc({ ...legacy, payment: { method: 'card' } }, settings);
    expect(doc.payments).toEqual([{ label: 'Card', value: usd(15.18) }]);
  });

  it('marks a refund unmistakably and signs its figures', () => {
    const doc = receiptDoc({
      ...sale,
      type: 'refund',
      number: 1043,
      refundOfNumber: 1042,
      refundOfDate: '2026-08-02',
      lines: [{ ...sale.lines[0], qty: -1, subtotal: -5.9, discountAmount: -0.59, tax: -0.5, total: -5.81 }],
      subtotal: -5.9, discountTotal: -0.59, taxTotal: -0.5, total: -5.81,
      taxes: [{ rate: 9.5, name: 'Prepared food', taxable: -5.31, tax: -0.5 }],
      payments: [{ method: 'cash', amount: -5.81 }],
    }, settings);

    expect(doc.refund).toBe(true);
    expect(doc.kind).toBe('REFUND');
    expect(doc.meta[0]).toBe('Refund #1043');
    expect(doc.meta[1]).toContain('for receipt #1042');
    // The app's own minus, matching the amount on the same line.
    expect(doc.items[0].qty).toBe('−1×');
    // Signed by the figure itself, with no minus bolted on the label.
    expect(doc.items[0].subs.map((s) => s.text)).toContain(`Discount ${usd(-0.59)}`);
    expect(doc.totals.find((t) => t.label === 'Discounts').value).toBe(usd(-0.59));
    expect(doc.payments[0].label).toBe('Cash refunded');
  });

  it('carries the void marking, so a shared copy can\'t pass for a live sale', () => {
    expect(receiptDoc({ ...sale, voidedAt: Date.now() }, settings).voided).toBe(true);
  });

  it('holds up with no store details and no extras', () => {
    const doc = receiptDoc({ ...sale, note: '', discountTotal: 0, taxes: [] }, {});
    expect(doc.storeName).toBe('Point of Sale');
    expect(doc.address).toBe('');
    expect(doc.footer).toBe('');
    expect(doc.note).toBe('');
    expect(doc.totals.map((t) => t.label)).toEqual(['Subtotal', 'Total']);
  });

  it('labels tax-inclusive rates as included', () => {
    const doc = receiptDoc({ ...sale, pricesIncludeTax: true }, settings);
    expect(doc.totals[2].label).toContain('(included)');
  });

  it('prefers the receipt\'s own registration snapshot over today\'s settings', () => {
    const doc = receiptDoc(
      { ...sale, registrations: [{ label: 'VAT No.', number: 'GB 111' }] },
      { ...settings, registrations: [{ label: 'VAT No.', number: 'GB 999' }] }
    );
    expect(doc.registrations).toEqual(['VAT No. GB 111']);
  });

  it('falls back to the store\'s numbers for receipts that predate them', () => {
    const doc = receiptDoc(sale, {
      ...settings,
      registrations: [{ label: 'ABN', number: '51 824 753 556' }, { label: '', number: 'X-42' }],
    });
    expect(doc.registrations).toEqual(['ABN 51 824 753 556', 'X-42']);
  });

  it('drops registration rows with nothing to print', () => {
    const doc = receiptDoc(sale, { ...settings, registrations: [{ label: 'VAT', number: '  ' }, null] });
    expect(doc.registrations).toEqual([]);
  });

  it('passes the store logo through for the renderers', () => {
    expect(receiptDoc(sale, settings).logo).toBeNull();
    expect(receiptDoc(sale, { ...settings, logo: 'data:image/png;base64,AAAA' }).logo)
      .toBe('data:image/png;base64,AAAA');
  });
});
