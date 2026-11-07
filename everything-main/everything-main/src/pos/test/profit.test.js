import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import {
  hasLineCost, lineCost, lineProfit, profitSummary, marginPercent, stockAtCost,
} from '../src/lib/profit.js';
import { lineItemsCsv } from '../src/lib/csv.js';
import { fullRefundPicks } from '../src/lib/refunds.js';

let mock;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

describe('cost on a product', () => {
  it('keeps a typed cost and treats an empty one as unknown, not zero', async () => {
    const costed = await store.addProduct({ name: 'Latte', price: 4.6, cost: '1.10' });
    const bare = await store.addProduct({ name: 'Chai', price: 3.4 });
    const free = await store.addProduct({ name: 'Tap water', price: 0.5, cost: 0 });

    expect(costed.cost).toBe(1.1);
    expect(bare.cost).toBeNull();
    // Zero is a real cost - a comp, a giveaway - and must survive as one.
    expect(free.cost).toBe(0);
  });

  it('refuses a negative or unusable cost rather than storing it', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, cost: -4 });
    expect(p.cost).toBeNull();
    const q = await store.addProduct({ name: 'Tote', price: 18, cost: 'nine' });
    expect(q.cost).toBeNull();
  });

  it('survives a backup round trip', async () => {
    await store.addProduct({ name: 'Beans', price: 14, cost: 8.2, trackStock: true, stock: 5 });
    const data = await store.exportAll();
    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    expect(fresh.products[0].cost).toBe(8.2);
  });
});

describe('cost snapshotted onto a sale', () => {
  async function sell({ cost = 1.1, qty = 2 } = {}) {
    const product = await store.addProduct({ name: 'Latte', price: 4.6, cost });
    const receipt = await store.completeSale({
      lines: [{
        productId: product.id, name: 'Latte', unitPrice: 4.6, qty,
        taxRate: 10, taxName: 'Tax', discount: null,
      }],
      payment: { method: 'card' },
    });
    return { product, receipt };
  }

  it('records the cost in force at sale time and never rewrites it', async () => {
    const { product, receipt } = await sell();
    expect(receipt.lines[0].unitCost).toBe(1.1);

    // The supplier raises the price; March must not change.
    await store.updateProduct(product.id, { name: 'Latte', price: 4.6, cost: 1.6 });
    const stored = (await store.loadMonth(receipt.date.slice(0, 7))).find((s) => s.id === receipt.id);
    expect(stored.lines[0].unitCost).toBe(1.1);
  });

  it('leaves the field off entirely when the product keeps no cost', async () => {
    const { receipt } = await sell({ cost: null });
    expect('unitCost' in receipt.lines[0]).toBe(false);
    expect(hasLineCost(receipt.lines[0])).toBe(false);
  });

  it('computes line cost and profit net of tax', async () => {
    const { receipt } = await sell();                 // 2 × 4.60, 10% tax
    const line = receipt.lines[0];
    expect(line.total).toBe(10.12);                   // 9.20 + 0.92 tax
    expect(lineCost(line)).toBe(2.2);
    // Tax is never margin: 9.20 net − 2.20 cost.
    expect(lineProfit(line)).toBe(7);
  });

  it('nets a refund back out of profit', async () => {
    const { receipt } = await sell();
    const refund = await store.refundSale({
      receiptId: receipt.id, date: receipt.date, picks: fullRefundPicks(receipt),
    });
    expect(refund.lines[0].unitCost).toBe(1.1);
    const summary = profitSummary([receipt, refund]);
    expect(summary.profit).toBe(0);
    expect(summary.cost).toBe(0);
  });
});

describe('profitSummary', () => {
  const line = (over = {}) => ({ qty: 1, total: 11, tax: 1, ...over });

  it('reports only what it knows, and says how much that is', () => {
    const sales = [{
      lines: [
        line({ unitCost: 4 }),          // net 10, cost 4 → profit 6
        line(),                         // uncosted: net 10, unknown
      ],
    }];
    const s = profitSummary(sales);
    expect(s.net).toBe(20);
    expect(s.knownNet).toBe(10);
    expect(s.profit).toBe(6);
    expect(s.margin).toBe(60);
    expect(s.coverage).toBeCloseTo(0.5, 5);
    expect(s.unknown).toBe(1);
    expect(s.any).toBe(true);
  });

  it('excludes voided sales', () => {
    const s = profitSummary([{ voidedAt: 1, lines: [line({ unitCost: 4 })] }]);
    expect(s.any).toBe(false);
    expect(s.profit).toBe(0);
    expect(s.margin).toBeNull();
  });

  it('says nothing at all when no cost was ever recorded', () => {
    const s = profitSummary([{ lines: [line(), line()] }]);
    expect(s.any).toBe(false);
    expect(s.coverage).toBe(0);
  });

  it('costs a measured line by its amount', () => {
    // 0.735 kg at 6.40/kg = 4.704 → 4.70
    const s = profitSummary([{ lines: [{ qty: 0.735, unit: 'kg', total: 9, tax: 0, unitCost: 6.4 }] }]);
    expect(s.cost).toBe(4.7);
    expect(s.profit).toBe(4.3);
  });
});

describe('marginPercent', () => {
  it('reads the margin off a price and a cost', () => {
    expect(marginPercent(4.2, 1.1)).toBe(73.81);
    expect(marginPercent(10, 10)).toBe(0);
    expect(marginPercent(10, 12)).toBe(-20);
  });

  it('has no answer without a cost or a price', () => {
    expect(marginPercent(4.2, null)).toBeNull();
    expect(marginPercent(0, 1)).toBeNull();
  });
});

describe('stockAtCost', () => {
  it('values the tracked shelf and counts what it had to leave out', () => {
    const value = stockAtCost([
      { stock: 10, cost: 8.2 },
      { stock: 3, cost: 9.5 },
      { stock: 4, cost: null },     // tracked, no cost - reported apart
      { stock: null, cost: 5 },     // untracked - not stock at all
    ]);
    expect(value.value).toBe(110.5);
    expect(value.counted).toBe(2);
    expect(value.unknown).toBe(1);
  });
});

describe('line items CSV', () => {
  it('carries cost and profit, and leaves them blank when unknown', async () => {
    const costed = await store.addProduct({ name: 'Latte', price: 4.6, cost: 1.1 });
    const bare = await store.addProduct({ name: 'Chai', price: 3.4 });
    const receipt = await store.completeSale({
      lines: [
        { productId: costed.id, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null },
        { productId: bare.id, name: 'Chai', unitPrice: 3.4, qty: 1, taxRate: 0, taxName: '', discount: null },
      ],
      payment: { method: 'cash', tendered: 10 },
    });
    const csv = lineItemsCsv([receipt], store);
    const [head, latte, chai] = csv.trim().split('\r\n');
    expect(head).toContain('Unit cost,Line cost,Gross profit');
    expect(latte).toContain('1.10,1.10,3.50');
    // Three empty cells where the cost columns are, not three zeros.
    expect(chai).toContain('3.40,,,');
  });
});
