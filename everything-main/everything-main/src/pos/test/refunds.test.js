import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store, receiptPayments } from '../src/lib/store.js';
import {
  isRefund, refundState, canRefund, refundPlan, refundedQty, refundableQty, fullRefundPicks,
} from '../src/lib/refunds.js';
import { computeCart } from '../src/lib/totals.js';
import { todayISO, monthKeyOf } from '../src/lib/dates.js';
import { round2 } from '../src/lib/util.js';
import { receiptsCsv } from '../src/lib/csv.js';

let mock;
let store;

const cents = (n) => Math.round(n * 100);

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

/** Latte ×3 @4.60 (10% tax) + Mug ×1 @16 (10% tax), 10% off the order. */
async function messySale(over = {}) {
  const lines = [
    { productId: 'p-latte', name: 'Latte', unitPrice: 4.6, qty: 3, taxRate: 10, taxName: 'Tax', discount: null },
    { productId: 'p-mug', name: 'Mug', unitPrice: 16, qty: 1, taxRate: 10, taxName: 'Tax', discount: { type: 'percent', value: 25 } },
  ];
  return store.completeSale({
    lines,
    orderDiscount: { type: 'percent', value: 10 },
    payment: { method: 'card' },
    ...over,
  });
}

describe('refunds of measured lines', () => {
  /** 0.735 kg of ham at $12.00/kg (10% tax) - $8.82 base, cent-exact. */
  async function weighedSale() {
    return store.completeSale({
      lines: [{ productId: 'p-ham', name: 'Ham', unitPrice: 12, qty: 0.735, unit: 'kg', taxRate: 10, taxName: 'Tax', discount: null }],
      payment: { method: 'card' },
    });
  }

  it('refunds a decimal amount, cumulative to the cent', async () => {
    const sale = await weighedSale();
    expect(sale.lines[0].unit).toBe('kg');

    const first = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 0.3 }],
    });
    expect(first.lines[0].qty).toBe(-0.3);
    expect(first.lines[0].unit).toBe('kg');
    expect(refundState(sale)).toBe('partial');
    expect(refundableQty(sale.lines[0])).toBe(0.435);

    const second = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 0.435 }],
    });
    // Returned in two pieces, the customer got back exactly what they paid.
    expect(round2(first.total + second.total)).toBe(-sale.total);
    expect(round2(first.taxTotal + second.taxTotal)).toBe(-sale.taxTotal);
    expect(refundState(sale)).toBe('full');
    expect(canRefund(sale)).toBe(false);
  });

  it('caps the pick at what is still refundable', async () => {
    const sale = await weighedSale();
    const plan = refundPlan(sale, [{ index: 0, qty: 9 }]);
    expect(plan.lines[0].qty).toBe(-0.735);
    expect(plan.restock).toEqual([{ productId: 'p-ham', qty: 0.735 }]);
  });
});

describe('refund bookkeeping', () => {
  it('starts with nothing refunded and everything refundable', async () => {
    const sale = await messySale();
    expect(isRefund(sale)).toBe(false);
    expect(refundState(sale)).toBe('none');
    expect(canRefund(sale)).toBe(true);
    expect(fullRefundPicks(sale)).toEqual([{ index: 0, qty: 3 }, { index: 1, qty: 1 }]);
  });

  it('records a full refund as its own negative receipt', async () => {
    const sale = await messySale();
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale), method: 'cash',
    });

    expect(isRefund(refund)).toBe(true);
    expect(refund.number).toBe(sale.number + 1);
    expect(refund.refundOf).toBe(sale.id);
    expect(refund.refundOfNumber).toBe(sale.number);
    expect(refund.type).toBe('refund');
    // A full refund gives back exactly what the sale took, to the cent.
    expect(refund.total).toBe(-sale.total);
    expect(refund.subtotal).toBe(-sale.subtotal);
    expect(refund.discountTotal).toBe(-sale.discountTotal);
    expect(refund.taxTotal).toBe(-sale.taxTotal);
    expect(refund.itemCount).toBe(-sale.itemCount);
    expect(receiptPayments(refund)).toEqual([{ method: 'cash', amount: refund.total }]);
    expect(refund.currency).toBe(sale.currency);
  });

  it('marks the original refunded, and refuses the same units twice', async () => {
    const sale = await messySale();
    await store.refundSale({ receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale) });

    const stored = (await store.loadMonth(monthKeyOf(sale.date))).find((s) => s.id === sale.id);
    expect(refundState(stored)).toBe('full');
    expect(canRefund(stored)).toBe(false);
    expect(stored.lines.map(refundableQty)).toEqual([0, 0]);
    expect(stored.refunds).toHaveLength(1);

    await expect(store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    })).rejects.toThrow(/already been refunded/);
  });

  it('is cent-exact when the same line comes back one unit at a time', async () => {
    const sale = await messySale();
    // Priced before anything comes back: refunding marks the original up.
    const oneShot = refundPlan(sale, [{ index: 0, qty: 3 }]).total;

    const totals = [];
    for (let i = 0; i < 3; i++) {
      const r = await store.refundSale({
        receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
      });
      totals.push(r.total);
    }
    const stored = (await store.loadMonth(monthKeyOf(sale.date))).find((s) => s.id === sale.id);
    expect(refundedQty(stored.lines[0])).toBe(3);
    expect(refundState(stored)).toBe('partial');

    // Three single-unit refunds sum to the one-shot refund of all three, and
    // no unit's share of the discount or tax is stranded by rounding.
    expect(cents(totals.reduce((a, t) => a + t, 0))).toBe(cents(oneShot));
    expect(new Set(totals.map(cents)).size).toBeLessThanOrEqual(2);

    // And the leftover mug is still refundable for its own exact share.
    const rest = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 1, qty: 1 }],
    });
    const all = totals.reduce((a, t) => a + t, 0) + rest.total;
    expect(cents(all)).toBe(cents(-sale.total));
  });

  it('prices a partial refund from the original line, discounts included', async () => {
    const sale = await messySale();
    // One latte of three: subtotal 4.60, its share of the 10% order discount,
    // and 10% tax on the discounted amount.
    const plan = refundPlan(sale, [{ index: 0, qty: 1 }]);
    expect(plan.subtotal).toBe(-4.6);
    expect(plan.discountTotal).toBe(-0.46);
    expect(plan.taxTotal).toBe(-0.41);
    expect(plan.total).toBe(-4.55);
    expect(plan.lines[0].qty).toBe(-1);
    expect(plan.taxes).toEqual([{ rate: 10, name: 'Tax', taxable: -4.14, tax: -0.41 }]);
  });

  it('caps a pick at what remains and ignores unknown lines', async () => {
    const sale = await messySale();
    const plan = refundPlan(sale, [{ index: 0, qty: 99 }, { index: 7, qty: 1 }, { index: 1, qty: 0 }]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].qty).toBe(-3);
  });

  it('keeps the original line\'s tax rate even after the rate changes', async () => {
    const tax = await store.addTax({ name: 'Tax', rate: 10 });
    const sale = await store.completeSale({
      lines: [{ productId: null, name: 'Thing', unitPrice: 10, qty: 1, taxRate: 10, taxName: 'Tax', discount: null }],
      payment: { method: 'card' },
    });
    await store.updateTax(tax.id, { name: 'Tax', rate: 25 });

    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    });
    expect(refund.taxTotal).toBe(-1);       // 10%, as charged - not 25%
    expect(refund.total).toBe(-11);
  });

  it('refunds tax-inclusive sales without changing the total', async () => {
    await store.updateSettings({ pricesIncludeTax: true });
    const sale = await store.completeSale({
      lines: [{ productId: null, name: 'Thing', unitPrice: 11, qty: 2, taxRate: 10, taxName: 'Tax', discount: null }],
      payment: { method: 'card' },
    });
    expect(sale.total).toBe(22);
    expect(sale.taxTotal).toBe(2);

    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    });
    expect(refund.total).toBe(-11);
    expect(refund.taxTotal).toBe(-1);
    expect(refund.pricesIncludeTax).toBe(true);
  });

  it('carries chosen options onto the refunded line', async () => {
    const options = [{ group: 'Size', name: 'Large', delta: 0.7 }];
    const sale = await store.completeSale({
      lines: [{ productId: 'p1', name: 'Latte', unitPrice: 5.3, qty: 1, taxRate: 0, taxName: '', discount: null, options }],
      payment: { method: 'card' },
    });
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    });
    expect(refund.lines[0].options).toEqual(options);
    expect(refund.total).toBe(-5.3);
  });
});

describe('refund stock', () => {
  it('puts tracked stock back when asked, and leaves it alone otherwise', async () => {
    const tracked = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    const loose = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1 });
    const lines = [
      { productId: tracked.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null },
      { productId: loose.id, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null },
    ];
    const sale = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(store.product(tracked.id).stock).toBe(3);

    await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }, { index: 1, qty: 1 }], restock: true,
    });
    expect(store.product(tracked.id).stock).toBe(4);
    expect(store.product(loose.id).stock).toBeNull();

    await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }], restock: false,
    });
    expect(store.product(tracked.id).stock).toBe(4);   // damaged goods stay off the shelf
  });
});

describe('refund guards', () => {
  it('refuses to refund a voided sale, and to void a refunded one', async () => {
    const sale = await messySale();
    const other = await messySale();

    await store.voidSale(sale.id, sale.date);
    await expect(store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    })).rejects.toThrow(/voided/);

    await store.refundSale({ receiptId: other.id, date: other.date, picks: [{ index: 0, qty: 1 }] });
    await expect(store.voidSale(other.id, other.date)).rejects.toThrow(/refund against it/);
  });

  it('refuses to refund or void a refund', async () => {
    const sale = await messySale();
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    });
    await expect(store.refundSale({
      receiptId: refund.id, date: refund.date, picks: [{ index: 0, qty: 1 }],
    })).rejects.toThrow(/refund can’t be refunded/);
    await expect(store.voidSale(refund.id, refund.date)).rejects.toThrow(/refund can’t be voided/);
    expect(canRefund(refund)).toBe(false);
  });

  /* refundPlan is the pricing boundary: two picks naming the same line must
     collapse into one, or each is priced as if the other didn't exist and a
     single plan pays the same units back twice. */
  it('consolidates duplicate picks for the same line', async () => {
    const sale = await store.completeSale({
      lines: [{ productId: null, name: 'Mug', unitPrice: 16, qty: 3, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    const plan = refundPlan(sale, [{ index: 0, qty: 2 }, { index: 0, qty: 2 }]);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0].qty).toBe(-3);   // 2 + 2 wanted, 3 sold - capped once
    expect(plan.total).toBe(-48);
  });

  /* A dismissed refund sheet retried while its write was still out fires a
     second call before the first's bookkeeping is applied. Both used to be
     priced against the pre-refund state - $64 back on a $32 sale. */
  it('overlapping refund calls can’t give the same units back twice', async () => {
    const sale = await store.completeSale({
      lines: [{ productId: null, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    const picks = [{ index: 0, qty: 2 }];
    const [a, b] = await Promise.allSettled([
      store.refundSale({ receiptId: sale.id, date: sale.date, picks }),
      store.refundSale({ receiptId: sale.id, date: sale.date, picks }),
    ]);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const failed = [a, b].find((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ok[0].value.total).toBe(-32);
    expect(String(failed.reason.message)).toMatch(/already been refunded/);

    const month = await store.loadMonth(monthKeyOf(sale.date));
    expect(month.filter(isRefund)).toHaveLength(1);
    expect(refundedQty(month.find((s) => s.id === sale.id).lines[0])).toBe(2);
  });

  it('rolls everything back when the write fails', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 4 });
    const sale = await store.completeSale({
      lines: [{ productId: p.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    const nextBefore = store.settings.nextReceipt;

    mock.failNextFsWrite();
    await expect(store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 2 }],
    })).rejects.toThrow();

    expect(store.settings.nextReceipt).toBe(nextBefore);
    expect(store.product(p.id).stock).toBe(2);
    const month = await store.loadMonth(monthKeyOf(sale.date));
    expect(month.filter(isRefund)).toHaveLength(0);
    const stored = month.find((s) => s.id === sale.id);
    expect(refundState(stored)).toBe('none');
    expect(stored.refunds).toBeUndefined();

    // And the retry works cleanly.
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 2 }],
    });
    expect(refund.total).toBe(-32);
    expect(store.product(p.id).stock).toBe(4);
  });

  it('refuses a receipt that is not there', async () => {
    await expect(store.refundSale({
      receiptId: 'ghost', date: todayISO(), picks: [{ index: 0, qty: 1 }],
    })).rejects.toThrow(/no longer here/);
  });

  it('never numbers a refund with a receipt number already filed', async () => {
    const sale = await messySale();

    // The counter's post-sale write is fire-and-forget; simulate it being
    // lost while the month file landed, then the app reloading.
    const stored = JSON.parse(mock.kv.get('pos:settings:v1'));
    mock.kv.set('pos:settings:v1', JSON.stringify({ ...stored, nextReceipt: 1001 }));
    const fresh = new Store();
    await fresh.init();

    const refund = await fresh.refundSale({
      receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale), method: 'cash',
    });
    expect(refund.number).toBe(sale.number + 1);
  });
});

describe('cross-month refunds', () => {
  it('files the refund under today while the sale keeps its own month', async () => {
    // A sale written directly into a past month, as history would hold it.
    const past = '2026-05-14';
    const pastKey = monthKeyOf(past);
    const lines = [{ productId: null, name: 'Coat', unitPrice: 90, qty: 1, taxRate: 10, taxName: 'Tax', discount: null }];
    const cart = computeCart(lines, {});
    const old = {
      id: 'old-sale', number: 500, date: past, at: new Date(`${past}T11:00`).getTime(),
      currency: 'USD', pricesIncludeTax: false, type: 'sale',
      lines: cart.lines.map((l) => ({
        productId: l.productId || null, name: l.name, unitPrice: l.unitPrice, qty: l.qty,
        taxRate: l.taxRate, taxName: l.taxName, discount: null,
        subtotal: l.subtotal, discountAmount: l.discountAmount, tax: l.tax, total: l.total,
      })),
      orderDiscount: null, itemCount: cart.itemCount, subtotal: cart.subtotal,
      discountTotal: cart.discountTotal, taxTotal: cart.taxTotal, taxes: cart.taxes,
      total: cart.total, payments: [{ method: 'card', amount: cart.total }],
    };
    mock.kv.set('pos:months:v1', JSON.stringify([pastKey]));
    mock.files.set(`pos-data/sales-${pastKey}.json`, JSON.stringify([old]));

    const fresh = new Store();
    await fresh.init();
    const refund = await fresh.refundSale({
      receiptId: 'old-sale', date: past, picks: [{ index: 0, qty: 1 }], method: 'cash',
    });

    expect(refund.date).toBe(todayISO());
    expect(refund.total).toBe(-99);
    const todayMonth = monthKeyOf(todayISO());
    expect(fresh.months).toContain(todayMonth);

    // Both files survive a reload, each holding its own record.
    const reloaded = new Store();
    await reloaded.init();
    const inPast = await reloaded.loadMonth(pastKey);
    const inNow = await reloaded.loadMonth(todayMonth);
    expect(refundState(inPast.find((s) => s.id === 'old-sale'))).toBe('full');
    if (pastKey === todayMonth) {
      expect(inNow.filter(isRefund)).toHaveLength(1);
    } else {
      expect(inNow.find((s) => s.id === refund.id).refundOf).toBe('old-sale');
      expect(inPast.filter(isRefund)).toHaveLength(0);
    }
  });
});

describe('a cross-month refund dying between its two writes', () => {
  /** A sale filed straight into a past month, minimal but complete. */
  const plantOldSale = (past) => {
    const lines = [{ productId: null, name: 'Coat', unitPrice: 90, qty: 1, taxRate: 0, taxName: '', discount: null }];
    const cart = computeCart(lines, {});
    const old = {
      id: 'old-sale', number: 500, date: past, at: new Date(`${past}T11:00`).getTime(),
      currency: 'USD', pricesIncludeTax: false, type: 'sale',
      lines: cart.lines.map((l) => ({
        productId: null, name: l.name, unitPrice: l.unitPrice, qty: l.qty,
        taxRate: 0, taxName: '', discount: null,
        subtotal: l.subtotal, discountAmount: l.discountAmount, tax: l.tax, total: l.total,
      })),
      orderDiscount: null, itemCount: cart.itemCount, subtotal: cart.subtotal,
      discountTotal: cart.discountTotal, taxTotal: cart.taxTotal, taxes: cart.taxes,
      total: cart.total, payments: [{ method: 'card', amount: cart.total }],
    };
    mock.kv.set('pos:months:v1', JSON.stringify([monthKeyOf(past)]));
    mock.files.set(`pos-data/sales-${monthKeyOf(past)}.json`, JSON.stringify([old]));
  };

  it('strands into a state that blocks a second payout, then heals on retry', async () => {
    // A past month that is never today's.
    const past = todayISO().startsWith('2026-01') ? '2025-11-14' : '2026-01-14';
    plantOldSale(past);
    const fresh = new Store();
    await fresh.init();

    // The network dies exactly when the refund receipt's write starts and
    // stays dead - so the compensating rewrite of the original fails too.
    const todayPath = `pos-data/sales-${monthKeyOf(todayISO())}.json`;
    const realWrite = puter.fs.write;
    let died = false;
    puter.fs.write = async (path, data) => {
      if (path === todayPath) died = true;
      if (died) throw new TypeError('Failed to fetch');
      return realWrite(path, data);
    };
    await expect(fresh.refundSale({
      receiptId: 'old-sale', date: past, picks: [{ index: 0, qty: 1 }],
    })).rejects.toThrow();
    puter.fs.write = realWrite;

    // What the cloud holds refuses a second refund - the failure direction
    // that can't pay the same money out twice.
    const reloaded = new Store();
    await reloaded.init();
    const stored = (await reloaded.loadMonth(monthKeyOf(past))).find((s) => s.id === 'old-sale');
    expect(canRefund(stored)).toBe(false);
    expect((await reloaded.loadMonth(monthKeyOf(todayISO()))).filter(isRefund)).toHaveLength(0);

    // The session that failed can simply retry: absolute bookkeeping means
    // the heal converges instead of stacking.
    const refund = await fresh.refundSale({
      receiptId: 'old-sale', date: past, picks: [{ index: 0, qty: 1 }],
    });
    expect(refund.total).toBe(-90);
    const healed = new Store();
    await healed.init();
    const original = (await healed.loadMonth(monthKeyOf(past))).find((s) => s.id === 'old-sale');
    expect(refundedQty(original.lines[0])).toBe(1);   // once, not twice
    expect(original.refunds).toHaveLength(1);
    expect((await healed.loadMonth(monthKeyOf(todayISO()))).filter(isRefund)).toHaveLength(1);
  });
});

describe('refunds in reports and exports', () => {
  it('nets out of revenue while counting separately', async () => {
    const sale = await messySale();
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    });
    const range = await store.salesInRange(todayISO(), todayISO());
    const live = range.filter((s) => !s.voidedAt);

    const net = round2(live.reduce((a, s) => a + s.total, 0));
    expect(net).toBe(round2(sale.total + refund.total));
    expect(live.filter((s) => !isRefund(s))).toHaveLength(1);
    expect(live.filter(isRefund)).toHaveLength(1);

    // Payments net per method: the card sale less the cash refund.
    const byMethod = new Map();
    for (const s of live) {
      for (const t of receiptPayments(s)) {
        byMethod.set(t.method, round2((byMethod.get(t.method) || 0) + t.amount));
      }
    }
    expect(byMethod.get('card')).toBe(sale.total);
    expect(byMethod.get('cash')).toBe(refund.total);
    expect(round2([...byMethod.values()].reduce((a, v) => a + v, 0))).toBe(net);
  });

  it('exports as a marked negative row referencing the original', async () => {
    const sale = await messySale();
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale), method: 'cash',
    });
    const rows = receiptsCsv([sale, refund]).trim().split('\r\n').map((r) => r.split(','));
    const head = rows[0];
    const row = rows.find((r) => Number(r[0]) === refund.number);
    expect(row[head.indexOf('Type')]).toBe('Refund');
    expect(Number(row[head.indexOf('Refund of')])).toBe(sale.number);
    expect(Number(row[head.indexOf('Total')])).toBe(refund.total);
    expect(Number(row[head.indexOf('Paid cash')])).toBe(refund.total);
    // Sale and refund together are a wash.
    const totals = rows.slice(1).reduce((a, r) => a + Number(r[head.indexOf('Total')]), 0);
    expect(round2(totals)).toBe(0);
  });
});
