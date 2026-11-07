import { describe, it, expect, beforeAll } from 'vitest';
import { sampleDataset } from '../src/lib/sample.js';
import { computeCart } from '../src/lib/totals.js';
import { optionUnitPrice, optionsKey } from '../src/lib/options.js';
import { receiptPayments } from '../src/lib/store.js';
import { monthKeyOf } from '../src/lib/dates.js';

const fakeStore = { settings: { currency: 'USD', theme: 'system' } };
let data;
let receipts;

beforeAll(() => {
  data = sampleDataset(fakeStore);
  receipts = Object.values(data.sales).flat();
});

describe('sampleDataset', () => {
  it('is shaped like an export importAll accepts', () => {
    expect(data.app).toBe('point-of-sale');
    expect(data.version).toBe(1);
    expect(data.settings.sampleData).toBe(true);
    expect(data.settings.onboarded).toBe(true);
    expect(data.products.length).toBeGreaterThan(10);
    expect(receipts.length).toBeGreaterThan(100);
  });

  it('references only real categories and taxes', () => {
    const catIds = new Set(data.categories.map((c) => c.id));
    const taxIds = new Set(data.taxes.map((t) => t.id));
    for (const p of data.products) {
      expect(catIds.has(p.categoryId)).toBe(true);
      if (p.taxId && p.taxId !== 'none') expect(taxIds.has(p.taxId)).toBe(true);
    }
    expect(taxIds.has(data.settings.defaultTaxId)).toBe(true);
  });

  it('files every receipt under its own month key', () => {
    for (const [key, list] of Object.entries(data.sales)) {
      for (const s of list) expect(monthKeyOf(s.date)).toBe(key);
    }
  });

  it('numbers receipts sequentially with no gaps', () => {
    const numbers = receipts.map((r) => r.number).sort((a, b) => a - b);
    numbers.forEach((n, i) => expect(n).toBe(1001 + i));
    expect(data.settings.nextReceipt).toBe(1001 + numbers.length);
  });

  it('every receipt matches what computeCart would produce today', () => {
    for (const r of receipts) {
      const cart = computeCart(r.lines, {
        orderDiscount: r.orderDiscount,
        pricesIncludeTax: r.pricesIncludeTax,
      });
      expect(r.subtotal).toBe(cart.subtotal);
      expect(r.discountTotal).toBe(cart.discountTotal);
      expect(r.taxTotal).toBe(cart.taxTotal);
      expect(r.total).toBe(cart.total);
      expect(r.itemCount).toBe(cart.itemCount);
    }
  });

  it('settles every receipt to the cent, splits included', () => {
    const cents = (n) => Math.round(n * 100);
    let splits = 0;
    for (const r of receipts) {
      const tenders = receiptPayments(r);
      expect(tenders.length).toBeGreaterThan(0);
      if (tenders.length > 1) splits++;
      expect(tenders.reduce((a, t) => a + cents(t.amount), 0)).toBe(cents(r.total));
      for (const t of tenders) {
        if (t.method !== 'cash' || t.tendered === undefined) {
          expect(t.change).toBeUndefined();
          continue;
        }
        expect(cents(t.tendered)).toBeGreaterThanOrEqual(cents(t.amount));
        expect(cents(t.tendered) - cents(t.amount)).toBe(cents(t.change || 0));
      }
    }
    // The dataset should actually exercise the split path.
    expect(splits).toBeGreaterThan(2);
  });

  it('sells the option groups its café products offer', () => {
    const withOptions = data.products.filter((p) => p.options?.length);
    expect(withOptions.length).toBeGreaterThan(3);
    for (const p of withOptions) {
      for (const g of p.options) {
        expect(g.name).toBeTruthy();
        expect(g.choices.length).toBeGreaterThan(1);
      }
    }

    const optionLines = receipts.flatMap((r) => r.lines).filter((l) => l.options?.length);
    expect(optionLines.length).toBeGreaterThan(50);
    // Every sold option belongs to that product's groups, and the line's unit
    // price is its base price plus the chosen deltas.
    const byId = new Map(data.products.map((p) => [p.id, p]));
    for (const l of optionLines) {
      const p = byId.get(l.productId);
      expect(p).toBeDefined();
      expect(l.unitPrice).toBe(optionUnitPrice(p.price, l.options));
      for (const o of l.options) {
        const group = p.options.find((g) => g.name === o.group);
        expect(group).toBeDefined();
        expect(group.choices.some((c) => c.name === o.name && c.delta === o.delta)).toBe(true);
      }
    }
  });

  it('keeps different option combinations on separate lines', () => {
    for (const r of receipts) {
      const keys = r.lines.map((l) => `${l.productId}|${optionsKey(l.options)}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('is deterministic across calls', () => {
    const again = sampleDataset(fakeStore);
    const flatten = (d) => Object.values(d.sales).flat().map((r) => `${r.number}:${r.total}`).join('|');
    expect(flatten(again)).toBe(flatten(data));
  });
});
