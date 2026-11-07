import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import {
  Store, receiptPayments, paymentKindOf, receiptChange, receiptTip, paymentMethodInfo,
} from '../src/lib/store.js';
import { receiptsCsv } from '../src/lib/csv.js';
import { receiptDoc } from '../src/lib/receipt-doc.js';
import { formatMoney } from '../src/lib/money.js';
import { round2 } from '../src/lib/util.js';

let mock;
let store;

/** $34.50 flat: 3 × $11.50, no tax, so the split arithmetic is easy to read. */
const lines = [{ productId: null, name: 'Panini', unitPrice: 11.5, qty: 3, taxRate: 0, taxName: '', discount: null }];

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

describe('split payments', () => {
  it('settles a sale across two tenders that sum to the total', async () => {
    const r = await store.completeSale({
      lines,
      payments: [{ method: 'cash', amount: 20 }, { method: 'card', amount: 14.5 }],
    });
    expect(r.total).toBe(34.5);
    expect(r.payments).toEqual([
      { method: 'cash', amount: 20 },
      { method: 'card', amount: 14.5 },
    ]);
    expect(paymentKindOf(r)).toBe('split');
    expect(paymentMethodInfo(paymentKindOf(r)).label).toBe('Split');
  });

  it('supports three tenders, in any method order', async () => {
    const r = await store.completeSale({
      lines,
      payments: [
        { method: 'other', amount: 10 },
        { method: 'card', amount: 4.5 },
        { method: 'cash', amount: 20 },
      ],
    });
    expect(receiptPayments(r).map((t) => t.method)).toEqual(['other', 'card', 'cash']);
    expect(round2(receiptPayments(r).reduce((a, t) => a + t.amount, 0))).toBe(r.total);
  });

  it('rejects a shortfall and an overpayment', async () => {
    await expect(store.completeSale({
      lines, payments: [{ method: 'cash', amount: 20 }, { method: 'card', amount: 10 }],
    })).rejects.toThrow(/don.t cover the total/);

    await expect(store.completeSale({
      lines, payments: [{ method: 'cash', amount: 20 }, { method: 'card', amount: 20 }],
    })).rejects.toThrow(/exceed the total/);

    // Nothing was recorded by either attempt.
    expect(store.settings.nextReceipt).toBe(1001);
  });

  it('rejects a one-cent shortfall (the whole point of integer cents)', async () => {
    await expect(store.completeSale({
      lines, payments: [{ method: 'cash', amount: 20 }, { method: 'card', amount: 14.49 }],
    })).rejects.toThrow(/don.t cover/);
    await expect(store.completeSale({
      lines, payments: [{ method: 'cash', amount: 20 }, { method: 'card', amount: 14.51 }],
    })).rejects.toThrow(/exceed/);
  });

  it('gives change only on the cash tender that overshoots', async () => {
    const r = await store.completeSale({
      lines,
      payments: [
        { method: 'cash', amount: 20, tendered: 25 },
        { method: 'card', amount: 14.5 },
      ],
    });
    expect(r.payments[0]).toEqual({ method: 'cash', amount: 20, tendered: 25, change: 5 });
    expect(r.payments[1].change).toBeUndefined();
    expect(receiptChange(r)).toBe(5);
    // Amounts still settle the sale exactly; change is not an overpayment.
    expect(round2(r.payments.reduce((a, t) => a + t.amount, 0))).toBe(r.total);
  });

  it('rejects a cash tender that does not cover its own amount', async () => {
    await expect(store.completeSale({
      lines, payments: [{ method: 'cash', amount: 20, tendered: 19 }, { method: 'card', amount: 14.5 }],
    })).rejects.toThrow(/doesn.t cover/);
  });

  it('drops empty tender rows rather than storing noise', async () => {
    const r = await store.completeSale({
      lines,
      payments: [{ method: 'cash', amount: 34.5 }, { method: 'card', amount: 0 }],
    });
    expect(r.payments).toHaveLength(1);
  });

  it('still records how a fully discounted sale was settled', async () => {
    const r = await store.completeSale({
      lines,
      orderDiscount: { type: 'percent', value: 100 },
      payments: [{ method: 'other', amount: 0 }],
    });
    expect(r.total).toBe(0);
    expect(r.payments).toEqual([{ method: 'other', amount: 0 }]);
    expect(paymentKindOf(r)).toBe('other');
  });

  it('normalizes an unknown method instead of storing it', async () => {
    const r = await store.completeSale({ lines, payments: [{ method: 'crypto', amount: 34.5 }] });
    expect(r.payments[0].method).toBe('other');
  });

  it('survives a reload as written', async () => {
    const r = await store.completeSale({
      lines, payments: [{ method: 'cash', amount: 20, tendered: 20 }, { method: 'card', amount: 14.5 }],
    });
    const reloaded = new Store();
    await reloaded.init();
    const stored = (await reloaded.loadMonth(r.date.slice(0, 7)))[0];
    expect(stored.payments).toEqual(r.payments);
    expect(paymentKindOf(stored)).toBe('split');
  });
});

describe('tips', () => {
  it('records a typed tip on a card tender without touching the totals', async () => {
    const r = await store.completeSale({
      lines, payments: [{ method: 'card', amount: 34.5, tip: 5 }],
    });
    expect(r.total).toBe(34.5);
    expect(r.taxTotal).toBe(0);
    expect(r.payments).toEqual([{ method: 'card', amount: 34.5, tip: 5 }]);
    expect(receiptTip(r)).toBe(5);
  });

  it('keep-the-change eats the cash overpay: tip recorded, no change due', async () => {
    const r = await store.completeSale({
      lines, payments: [{ method: 'cash', amount: 34.5, tendered: 40, tip: 5.5 }],
    });
    expect(r.payments[0]).toEqual({ method: 'cash', amount: 34.5, tendered: 40, tip: 5.5, change: 0 });
    expect(receiptChange(r)).toBe(0);
    expect(receiptTip(r)).toBe(5.5);
  });

  it('a partial keep still returns the rest as change', async () => {
    const r = await store.completeSale({
      lines, payments: [{ method: 'cash', amount: 34.5, tendered: 40, tip: 3 }],
    });
    expect(r.payments[0].tip).toBe(3);
    expect(r.payments[0].change).toBe(2.5);
  });

  it('rejects cash that covers the total but not the tip on top', async () => {
    await expect(store.completeSale({
      lines, payments: [{ method: 'cash', amount: 34.5, tendered: 35, tip: 5 }],
    })).rejects.toThrow(/doesn.t cover/);
  });

  it('keeps a tip-only tender on a fully discounted sale', async () => {
    const r = await store.completeSale({
      lines,
      orderDiscount: { type: 'percent', value: 100 },
      payments: [{ method: 'card', amount: 0, tip: 2 }],
    });
    expect(r.total).toBe(0);
    expect(r.payments).toEqual([{ method: 'card', amount: 0, tip: 2 }]);
    expect(receiptTip(r)).toBe(2);
  });

  it('shows the tip as its own receipt line, with the card charged figure', async () => {
    const r = await store.completeSale({
      lines, payments: [{ method: 'card', amount: 34.5, tip: 5 }],
    });
    const usd = (n) => formatMoney(n, 'USD');
    const doc = receiptDoc(r, {});
    expect(doc.payments[0]).toEqual({ label: 'Tip', value: usd(5) });
    expect(doc.payments[1]).toEqual({ label: 'Card', value: usd(39.5) });
  });

  it('exports a Tip column in the receipts CSV', async () => {
    const r = await store.completeSale({
      lines, payments: [{ method: 'card', amount: 34.5, tip: 5 }],
    });
    const rows = receiptsCsv([r]).trim().split('\r\n').map((row) => row.split(','));
    const iTip = rows[0].indexOf('Tip');
    expect(iTip).toBeGreaterThan(-1);
    expect(rows[1][iTip]).toBe('5.00');
  });
});

describe('legacy single-payment receipts', () => {
  /** A receipt as written before splits existed. Never rewritten on disk. */
  const legacy = {
    id: 'old', number: 900, date: '2026-05-04', at: Date.UTC(2026, 4, 4, 10),
    currency: 'USD', pricesIncludeTax: false, lines: [], orderDiscount: null,
    itemCount: 1, subtotal: 34.5, discountTotal: 0, taxTotal: 0, taxes: [],
    total: 34.5, payment: { method: 'cash', tendered: 40, change: 5.5 },
  };

  it('reads as a one-tender sale for its full total', () => {
    expect(receiptPayments(legacy)).toEqual([
      { method: 'cash', amount: 34.5, tendered: 40, change: 5.5 },
    ]);
    expect(paymentKindOf(legacy)).toBe('cash');
    expect(receiptChange(legacy)).toBe(5.5);
  });

  it('handles a legacy card receipt with no tender detail', () => {
    const card = { ...legacy, payment: { method: 'card' } };
    expect(receiptPayments(card)).toEqual([{ method: 'card', amount: 34.5 }]);
    expect(receiptChange(card)).toBe(0);
  });

  it('copes with a receipt that has no payment information at all', () => {
    const orphan = { ...legacy, payment: undefined };
    expect(receiptPayments(orphan)).toEqual([]);
    expect(paymentKindOf(orphan)).toBe('other');
    expect(receiptChange(orphan)).toBe(0);
  });

  it('is still written by the legacy completeSale call shape', async () => {
    const r = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(r.payments).toEqual([{ method: 'card', amount: 34.5 }]);
  });
});

describe('payments in the CSV', () => {
  const col = (rows, name) => rows[0].indexOf(name);
  const parse = (text) => text.trim().split('\r\n').map((r) => r.split(','));

  it('attributes split amounts per method and totals the change', async () => {
    const split = await store.completeSale({
      lines,
      payments: [{ method: 'cash', amount: 20, tendered: 25 }, { method: 'card', amount: 14.5 }],
    });
    const legacy = {
      ...split, id: 'legacy', number: 1, payments: undefined,
      payment: { method: 'cash', tendered: 40, change: 5.5 },
    };

    const rows = parse(receiptsCsv([split, legacy]));
    const iCash = col(rows, 'Paid cash');
    const iCard = col(rows, 'Paid card');
    const iOther = col(rows, 'Paid other');
    const iPay = col(rows, 'Payment');
    const iChange = col(rows, 'Change');

    const splitRow = rows.find((r) => Number(r[0]) === split.number);
    expect(splitRow[iPay]).toBe('Split');
    expect(splitRow[iCash]).toBe('20.00');
    expect(splitRow[iCard]).toBe('14.50');
    expect(splitRow[iOther]).toBe('0.00');
    expect(splitRow[iChange]).toBe('5.00');
    // Per-method amounts reconcile with the receipt total.
    expect(Number(splitRow[iCash]) + Number(splitRow[iCard])).toBe(split.total);

    const legacyRow = rows.find((r) => Number(r[0]) === 1);
    expect(legacyRow[iPay]).toBe('Cash');
    expect(legacyRow[iCash]).toBe('34.50');
    expect(legacyRow[iChange]).toBe('5.50');
  });
});
