import { describe, it, expect } from 'vitest';
import { computeTotals, lineTotal, amountPaid } from '../src/core/totals.js';

const items = [
  { qty: 2, unitPrice: 5000, unitCost: 2000 },
  { qty: 1.5, unitPrice: 8000, unitCost: 0, taxable: false },
  { qty: 1, unitPrice: 9900, optional: true },
];

describe('totals', () => {
  it('multiplies fractional quantities to whole cents', () => {
    expect(lineTotal({ qty: 1.5, unitPrice: 333 })).toBe(500);
    expect(lineTotal({ qty: '', unitPrice: 100 })).toBe(0);
  });

  it('leaves unselected optional items out', () => {
    expect(computeTotals({ items }).subtotal).toBe(22000);
    const withOptional = items.map((it) => (it.optional ? { ...it, selected: true } : it));
    expect(computeTotals({ items: withOptional }).subtotal).toBe(31900);
  });

  it('applies tax only to the discounted taxable share', () => {
    const t = computeTotals({ items, discount: { type: 'pct', value: 10 }, taxRate: 10 });
    expect(t.discount).toBe(2200);
    // taxable 10000 minus its 10% share of the discount = 9000, taxed at 10%.
    expect(t.tax).toBe(900);
    expect(t.total).toBe(22000 - 2200 + 900);
    expect(t.cost).toBe(4000);
    expect(t.profit).toBe(22000 - 2200 - 4000);
  });

  it('never discounts below zero', () => {
    expect(computeTotals({ items, discount: { type: 'amt', value: 999999 } }).total).toBe(0);
  });

  it('computes deposits as a share or a fixed amount', () => {
    expect(computeTotals({ items, deposit: { type: 'pct', value: 50 } }).deposit).toBe(11000);
    expect(computeTotals({ items, deposit: { type: 'amt', value: 5000 } }).deposit).toBe(5000);
  });

  it('sums payments for an invoice, ignoring voided ones', () => {
    const payments = [
      { invoiceId: 'a', amount: 100 },
      { invoiceId: 'a', amount: 50, voided: true },
      { invoiceId: 'b', amount: 70 },
    ];
    expect(amountPaid('a', payments)).toBe(100);
  });

  it('never asks for a negative deposit', () => {
    const items = [{ qty: 1, unitPrice: 10000 }];
    expect(computeTotals({ items, deposit: { type: 'amt', value: -500 } }).deposit).toBe(0);
    expect(computeTotals({ items, deposit: { type: 'pct', value: -10 } }).deposit).toBe(0);
  });
});
