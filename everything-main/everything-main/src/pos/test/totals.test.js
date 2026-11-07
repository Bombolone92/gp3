import { describe, it, expect } from 'vitest';
import {
  computeCart, discountCents, allocate, changeDue, tenderSuggestions, validDiscount,
} from '../src/lib/totals.js';

const line = (over = {}) => ({
  name: 'Item', unitPrice: 10, qty: 1, taxRate: 0, taxName: '', discount: null, ...over,
});

describe('validDiscount', () => {
  it('accepts percent and fixed with positive values', () => {
    expect(validDiscount({ type: 'percent', value: 10 })).toBe(true);
    expect(validDiscount({ type: 'fixed', value: 2.5 })).toBe(true);
  });

  it('rejects null, unknown types, non-positive and over-100 percent', () => {
    expect(validDiscount(null)).toBe(false);
    expect(validDiscount({ type: 'bogus', value: 10 })).toBe(false);
    expect(validDiscount({ type: 'percent', value: 0 })).toBe(false);
    expect(validDiscount({ type: 'percent', value: -5 })).toBe(false);
    expect(validDiscount({ type: 'percent', value: 101 })).toBe(false);
    expect(validDiscount({ type: 'fixed', value: NaN })).toBe(false);
  });
});

describe('discountCents', () => {
  it('computes percent of the base', () => {
    expect(discountCents(1000, { type: 'percent', value: 10 })).toBe(100);
  });

  it('caps fixed discounts at the base so lines never go negative', () => {
    expect(discountCents(500, { type: 'fixed', value: 99 })).toBe(500);
  });

  it('returns 0 for invalid discounts', () => {
    expect(discountCents(1000, null)).toBe(0);
    expect(discountCents(1000, { type: 'percent', value: 0 })).toBe(0);
  });
});

describe('allocate (largest remainder)', () => {
  it('always sums exactly to the total', () => {
    const parts = allocate(100, [333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('is proportional for equal weights', () => {
    expect(allocate(90, [100, 100, 100])).toEqual([30, 30, 30]);
  });

  it('never gives a share above its weight', () => {
    const parts = allocate(150, [100, 10]);
    expect(parts[0]).toBeLessThanOrEqual(100);
    expect(parts[1]).toBeLessThanOrEqual(10);
    // Total above the weight sum is capped, not invented.
    expect(parts.reduce((a, b) => a + b, 0)).toBe(110);
  });

  it('handles zero weights and zero totals', () => {
    expect(allocate(0, [10, 20])).toEqual([0, 0]);
    expect(allocate(100, [0, 0])).toEqual([0, 0]);
  });
});

describe('computeCart - basics', () => {
  it('multiplies unit price by quantity', () => {
    const cart = computeCart([line({ unitPrice: 4.6, qty: 3 })]);
    expect(cart.subtotal).toBe(13.8);
    expect(cart.total).toBe(13.8);
    expect(cart.itemCount).toBe(3);
  });

  it('sums several lines', () => {
    const cart = computeCart([
      line({ unitPrice: 3.2, qty: 2 }),
      line({ unitPrice: 9.4, qty: 1 }),
    ]);
    expect(cart.subtotal).toBe(15.8);
    expect(cart.lines).toHaveLength(2);
  });

  it('treats an empty cart as zero everywhere', () => {
    const cart = computeCart([]);
    expect(cart.total).toBe(0);
    expect(cart.itemCount).toBe(0);
    expect(cart.taxes).toEqual([]);
  });

  it('drops fractional quantities to whole units', () => {
    const cart = computeCart([line({ qty: 2.7 })]);
    expect(cart.itemCount).toBe(3);
  });
});

describe('computeCart - sold by measure', () => {
  it('takes decimal quantities on lines with a unit, rounded once to cents', () => {
    // 0.735 kg × $12.00/kg = $8.82 exactly, half-up.
    const cart = computeCart([line({ unitPrice: 12, qty: 0.735, unit: 'kg' })]);
    expect(cart.subtotal).toBe(8.82);
    expect(cart.total).toBe(8.82);
    expect(cart.lines[0].qty).toBe(0.735);
  });

  it('quantities keep at most 3 decimals', () => {
    const cart = computeCart([line({ unitPrice: 10, qty: 0.12345, unit: 'kg' })]);
    expect(cart.lines[0].qty).toBe(0.123);
  });

  it('a measured line counts as one item in the basket', () => {
    const cart = computeCart([
      line({ unitPrice: 12, qty: 0.735, unit: 'kg' }),
      line({ unitPrice: 3, qty: 2 }),
    ]);
    expect(cart.itemCount).toBe(3);
  });

  it('discounts and tax run on the cent-exact measured line total', () => {
    const cart = computeCart([line({
      unitPrice: 12, qty: 0.735, unit: 'kg', taxRate: 10,
      discount: { type: 'percent', value: 50 },
    })]);
    // base 882 → disc 441 → tax 44 → total 4.85; everything agrees.
    expect(cart.subtotal).toBe(8.82);
    expect(cart.discountTotal).toBe(4.41);
    expect(cart.taxTotal).toBe(0.44);
    expect(cart.total).toBe(4.85);
  });
});

describe('computeCart - discounts', () => {
  it('applies a percent line discount', () => {
    const cart = computeCart([line({ unitPrice: 20, qty: 1, discount: { type: 'percent', value: 25 } })]);
    expect(cart.lineDiscountTotal).toBe(5);
    expect(cart.total).toBe(15);
  });

  it('applies a fixed line discount capped at the line', () => {
    const cart = computeCart([line({ unitPrice: 5, qty: 1, discount: { type: 'fixed', value: 8 } })]);
    expect(cart.total).toBe(0);
  });

  it('applies a percent order discount across the cart', () => {
    const cart = computeCart(
      [line({ unitPrice: 10 }), line({ unitPrice: 30 })],
      { orderDiscount: { type: 'percent', value: 10 } }
    );
    expect(cart.orderDiscountAmount).toBe(4);
    expect(cart.total).toBe(36);
  });

  it('prorates the order discount so per-line discounts sum exactly', () => {
    // $1.00 off three equal $1 lines cannot split evenly - largest
    // remainder must land the odd cent somewhere, and the sum must hold.
    const cart = computeCart(
      [line({ unitPrice: 1 }), line({ unitPrice: 1 }), line({ unitPrice: 1 })],
      { orderDiscount: { type: 'fixed', value: 1 } }
    );
    const perLine = cart.lines.reduce((a, l) => a + Math.round(l.discountAmount * 100), 0);
    expect(perLine).toBe(100);
    expect(cart.total).toBe(2);
  });

  it('stacks line and order discounts (order applies to the discounted sum)', () => {
    const cart = computeCart(
      [line({ unitPrice: 100, discount: { type: 'percent', value: 50 } })],
      { orderDiscount: { type: 'percent', value: 10 } }
    );
    // 100 → 50 after line discount → 45 after 10% order discount.
    expect(cart.discountTotal).toBe(55);
    expect(cart.total).toBe(45);
  });

  it('caps a fixed order discount at the cart value', () => {
    const cart = computeCart([line({ unitPrice: 3 })], { orderDiscount: { type: 'fixed', value: 50 } });
    expect(cart.total).toBe(0);
    expect(cart.orderDiscountAmount).toBe(3);
  });
});

describe('computeCart - taxes (exclusive)', () => {
  it('adds tax on top of the discounted price', () => {
    const cart = computeCart([line({ unitPrice: 100, taxRate: 8, taxName: 'Sales tax' })]);
    expect(cart.taxTotal).toBe(8);
    expect(cart.total).toBe(108);
  });

  it('taxes the post-discount amount, not the sticker price', () => {
    const cart = computeCart(
      [line({ unitPrice: 100, taxRate: 10, discount: { type: 'percent', value: 50 } })],
      { orderDiscount: { type: 'fixed', value: 10 } }
    );
    // 100 → 50 (line) → 40 (order) → 4 tax.
    expect(cart.taxTotal).toBe(4);
    expect(cart.total).toBe(44);
  });

  it('groups the breakdown by rate and name', () => {
    const cart = computeCart([
      line({ unitPrice: 10, taxRate: 7.75, taxName: 'Sales tax' }),
      line({ unitPrice: 20, taxRate: 7.75, taxName: 'Sales tax' }),
      line({ unitPrice: 5, taxRate: 9.5, taxName: 'Prepared food' }),
    ]);
    expect(cart.taxes).toHaveLength(2);
    const sales = cart.taxes.find((t) => t.rate === 7.75);
    expect(sales.taxable).toBe(30);
    expect(sales.tax).toBe(2.33); // round(3000 * 0.0775) = 233 cents
  });

  it('skips tax-free lines in the breakdown', () => {
    const cart = computeCart([line({ taxRate: 0 })]);
    expect(cart.taxes).toEqual([]);
  });

  it('keeps subtotal − discounts + tax === total to the cent', () => {
    const cart = computeCart(
      [
        line({ unitPrice: 3.33, qty: 3, taxRate: 8.875, taxName: 'NY' }),
        line({ unitPrice: 7.77, qty: 2, taxRate: 8.875, taxName: 'NY', discount: { type: 'percent', value: 15 } }),
        line({ unitPrice: 0.99, qty: 7 }),
      ],
      { orderDiscount: { type: 'percent', value: 12.5 } }
    );
    const cents = (n) => Math.round(n * 100);
    expect(cents(cart.subtotal) - cents(cart.discountTotal) + cents(cart.taxTotal))
      .toBe(cents(cart.total));
  });
});

describe('computeCart - taxes (inclusive)', () => {
  it('extracts the tax portion without changing the total', () => {
    const cart = computeCart(
      [line({ unitPrice: 110, taxRate: 10, taxName: 'VAT' })],
      { pricesIncludeTax: true }
    );
    expect(cart.total).toBe(110);
    expect(cart.taxTotal).toBe(10);
  });

  it('total equals subtotal minus discounts (tax already inside)', () => {
    const cart = computeCart(
      [line({ unitPrice: 25, qty: 2, taxRate: 20, taxName: 'VAT' })],
      { orderDiscount: { type: 'percent', value: 10 }, pricesIncludeTax: true }
    );
    expect(cart.total).toBe(45);
    // 45 gross at 20% inclusive → 45 − 45/1.2 = 7.50 tax.
    expect(cart.taxTotal).toBe(7.5);
  });
});

describe('changeDue', () => {
  it('returns the difference when covered', () => {
    expect(changeDue(12.4, 20)).toBe(7.6);
    expect(changeDue(10, 10)).toBe(0);
  });

  it('returns null while short', () => {
    expect(changeDue(10, 9.99)).toBeNull();
  });

  it('is exact for classic float traps', () => {
    expect(changeDue(0.1 + 0.2, 1)).toBe(0.7);
  });
});

describe('tenderSuggestions', () => {
  it('starts with the exact amount and rises to round bills', () => {
    const s = tenderSuggestions(12.4);
    expect(s[0]).toBe(12.4);
    expect(s).toContain(13);
    expect(s).toContain(15);
    expect(s).toContain(20);
  });

  it('never suggests below the total and stays sorted', () => {
    const s = tenderSuggestions(7.01);
    expect(s.every((v) => v >= 7.01)).toBe(true);
    expect([...s].sort((a, b) => a - b)).toEqual(s);
  });

  it('keeps the exact chip exact for totals whose ×100 lands above the integer', () => {
    // 9.96 * 100 === 996.0000000000001; a ceil on that read $9.97 to the cashier.
    expect(tenderSuggestions(9.96)[0]).toBe(9.96);
    expect(tenderSuggestions(8.29)[0]).toBe(8.29);
    expect(tenderSuggestions(0.07)[0]).toBe(0.07);
  });
});
