import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { taxSummary, taxRowLabel, effectiveRate } from '../src/lib/tax-report.js';
import { taxSummaryCsv } from '../src/lib/csv.js';
import { fullRefundPicks } from '../src/lib/refunds.js';

let mock;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

/** A sale of the given lines, through the store so the totals are real. */
async function sell(lines, { includeTax = false } = {}) {
  if (includeTax !== !!store.settings.pricesIncludeTax) {
    await store.updateSettings({ pricesIncludeTax: includeTax });
  }
  return store.completeSale({ lines, payment: { method: 'card' } });
}

const line = (over = {}) => ({
  productId: null, name: 'Thing', unitPrice: 10, qty: 1,
  taxRate: 0, taxName: '', discount: null, ...over,
});

describe('taxSummary', () => {
  it('gives one row per rate, and reconciles with the receipt', async () => {
    const receipt = await sell([
      line({ name: 'Latte', unitPrice: 4, qty: 2, taxRate: 9.5, taxName: 'Prepared food' }),
      line({ name: 'Beans', unitPrice: 14, taxRate: 7.75, taxName: 'Sales tax' }),
    ]);
    const s = taxSummary([receipt]);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0]).toMatchObject({ name: 'Sales tax', rate: 7.75, base: 14, tax: 1.09 });
    expect(s.rows[1]).toMatchObject({ name: 'Prepared food', rate: 9.5, base: 8, tax: 0.76 });
    // The card's total must agree with the tile above it, to the cent.
    expect(s.tax).toBe(receipt.taxTotal);
    expect(s.gross).toBe(receipt.total);
    expect(s.base).toBe(22);
  });

  it('keeps tax-free and zero-rated trade on their own rows', async () => {
    const receipt = await sell([
      line({ name: 'Book', unitPrice: 20, taxRate: 0, taxName: 'Zero-rated' }),
      line({ name: 'Voucher', unitPrice: 5, taxRate: 0, taxName: '' }),
      line({ name: 'Latte', unitPrice: 4, taxRate: 10, taxName: 'Sales tax' }),
    ]);
    const s = taxSummary([receipt]);
    expect(s.rows.map(taxRowLabel)).toEqual(['Sales tax 10%', 'Zero-rated 0%', 'Tax-free']);
    expect(s.rows[1]).toMatchObject({ kind: 'zero', base: 20, tax: 0 });
    expect(s.rows[2]).toMatchObject({ kind: 'free', base: 5, tax: 0 });
    expect(s.gross).toBe(receipt.total);
  });

  it('reads a tax-inclusive sale as gross taken with the tax inside it', async () => {
    const receipt = await sell([line({ unitPrice: 11, taxRate: 10, taxName: 'VAT' })], { includeTax: true });
    const s = taxSummary([receipt]);
    expect(s.inclusive).toBe(true);
    expect(s.rows[0]).toMatchObject({ gross: 11, tax: 1, base: 10 });
    expect(s.gross).toBe(receipt.total);
  });

  it('nets a refund out at the rate its sale was rung up at', async () => {
    const receipt = await sell([line({ unitPrice: 10, taxRate: 10, taxName: 'Sales tax' })]);
    const refund = await store.refundSale({
      receiptId: receipt.id, date: receipt.date, picks: fullRefundPicks(receipt),
    });
    // The rate changes afterwards; the refund still nets the old one out.
    const s = taxSummary([receipt, refund]);
    expect(s.tax).toBe(0);
    expect(s.base).toBe(0);
    expect(s.rows[0].rate).toBe(10);
  });

  it('excludes voided sales and says when it has nothing', () => {
    const s = taxSummary([{ voidedAt: 1, lines: [{ total: 11, tax: 1, taxRate: 10, taxName: 'T' }] }]);
    expect(s.any).toBe(false);
    expect(s.tax).toBe(0);
  });

  it('marks a period whose price mode changed part-way', async () => {
    const a = await sell([line({ unitPrice: 10, taxRate: 10, taxName: 'T' })]);
    const b = await sell([line({ unitPrice: 11, taxRate: 10, taxName: 'T' })], { includeTax: true });
    const s = taxSummary([a, b]);
    expect(s.mixed).toBe(true);
    // One rate, both sales, and the gross still equals what was taken.
    expect(s.rows).toHaveLength(1);
    expect(s.gross).toBe(a.total + b.total);
  });
});

describe('effectiveRate', () => {
  it('is the rate the money actually worked out at', () => {
    expect(effectiveRate({ base: 100, tax: 7.75 })).toBe(7.75);
    expect(effectiveRate({ base: 0, tax: 0 })).toBeNull();
  });
});

describe('taxSummaryCsv', () => {
  it('writes a filing-shaped extract with a total that adds up', async () => {
    const receipt = await sell([
      line({ unitPrice: 10, taxRate: 10, taxName: 'Sales tax' }),
      line({ name: 'Voucher', unitPrice: 5 }),
    ]);
    const csv = taxSummaryCsv(taxSummary([receipt]), {
      from: '2026-07-01', to: '2026-09-30', currency: 'USD', storeName: 'Corner Roast',
    });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Tax summary,Corner Roast');
    expect(lines).toContain('Rate name,Rate %,Taxable base,Tax collected,Gross');
    expect(lines).toContain('Sales tax,10,10.00,1.00,11.00');
    // A tax-free row carries no rate at all, not a zero.
    expect(lines).toContain('Tax-free,,5.00,0.00,5.00');
    expect(lines[lines.length - 1]).toBe('Total,,15.00,1.00,16.00');
  });
});
