import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { daySummary, movementTotals, overShortLabel } from '../src/lib/drawer.js';
import { todayISO, monthKeyOf } from '../src/lib/dates.js';
import { sampleDataset } from '../src/lib/sample.js';

let mock;
let store;

const money = (n) => `$${Math.abs(n).toFixed(2)}`;
const today = () => todayISO();

const line = (price, qty = 1) => ([
  { productId: null, name: 'Thing', unitPrice: price, qty, taxRate: 0, taxName: '', discount: null },
]);

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => mock.uninstall());

describe('movementTotals', () => {
  it('splits signed movements into paid in and paid out', () => {
    expect(movementTotals([{ amount: 20 }, { amount: -6.5 }, { amount: -3.5 }, { amount: 0 }]))
      .toEqual({ paidIn: 20, paidOut: 10 });
    expect(movementTotals([])).toEqual({ paidIn: 0, paidOut: 0 });
    expect(movementTotals(null)).toEqual({ paidIn: 0, paidOut: 0 });
  });
});

describe('overShortLabel', () => {
  it('names the three outcomes', () => {
    expect(overShortLabel(0, money)).toBe('Balanced');
    expect(overShortLabel(2, money)).toBe('Over $2.00');
    expect(overShortLabel(-1.35, money)).toBe('Short $1.35');
  });
});

describe('expected cash', () => {
  it('adds float, cash taken, and paid in; subtracts refunds and paid out', async () => {
    await store.openDrawer({ float: 100 });
    // Cash 40, card 25, and a split that puts 10 more in the drawer.
    await store.completeSale({ lines: line(40), payment: { method: 'cash', tendered: 50 } });
    await store.completeSale({ lines: line(25), payment: { method: 'card' } });
    await store.completeSale({ lines: line(30), payments: [{ method: 'cash', amount: 10 }, { method: 'card', amount: 20 }] });
    await store.addCashMovement({ amount: 20, reason: 'Float top-up' });
    await store.addCashMovement({ amount: -12.5, reason: 'Courier' });

    const s = await store.drawerSummary();
    expect(s.float).toBe(100);
    expect(s.cashSales).toBe(50);          // 40 + 10, not the 50 handed over
    expect(s.cashRefunds).toBe(0);
    expect(s.paidIn).toBe(20);
    expect(s.paidOut).toBe(12.5);
    expect(s.expected).toBe(157.5);
    expect(s.salesCount).toBe(3);
    expect(s.byMethod.find((m) => m.method === 'card').amount).toBe(45);
  });

  it('counts cash tips into expected cash, card tips apart', async () => {
    await store.openDrawer({ float: 100 });
    // Keep-the-change: $40 handed over on a $34.50 sale, tip kept in drawer.
    await store.completeSale({
      lines: line(34.5),
      payments: [{ method: 'cash', amount: 34.5, tendered: 40, tip: 5.5 }],
    });
    // Terminal slip with a written tip: charged $25 + $3.
    await store.completeSale({
      lines: line(25),
      payments: [{ method: 'card', amount: 25, tip: 3 }],
    });

    const s = await store.drawerSummary();
    expect(s.cashSales).toBe(34.5);
    expect(s.cashTips).toBe(5.5);
    expect(s.tipTotal).toBe(8.5);
    expect(s.tips).toHaveLength(2);
    expect(s.tips).toContainEqual({ method: 'cash', amount: 5.5, count: 1 });
    expect(s.tips).toContainEqual({ method: 'card', amount: 3, count: 1 });
    // The drawer physically holds the kept tip; the card tip never entered it.
    expect(s.expected).toBe(140);
    // Takings by method stay sale money only, so revenue still reconciles.
    expect(s.byMethod.find((m) => m.method === 'cash').amount).toBe(34.5);
    expect(s.byMethod.find((m) => m.method === 'card').amount).toBe(25);

    const day = await store.closeDrawer({ counted: 140 });
    expect(day.close.diff).toBe(0);
    expect(day.close.cashTips).toBe(5.5);
    expect(day.close.tipTotal).toBe(8.5);
    expect(day.close.tips).toHaveLength(2);
  });

  it('takes cash refunds back out of the drawer', async () => {
    await store.openDrawer({ float: 50 });
    const sale = await store.completeSale({ lines: line(30, 2), payment: { method: 'cash' } });
    await store.refundSale({ receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }], method: 'cash' });

    const s = await store.drawerSummary();
    expect(s.cashSales).toBe(60);
    expect(s.cashRefunds).toBe(30);
    expect(s.expected).toBe(80);
    expect(s.salesCount).toBe(1);
    expect(s.refundCount).toBe(1);
    expect(s.revenue).toBe(30);
    // A card refund would leave the drawer alone.
    const s2 = daySummary({
      date: today(),
      day: { float: 50, movements: [] },
      sales: [{ total: -30, taxTotal: 0, discountTotal: 0, type: 'refund', payments: [{ method: 'card', amount: -30 }] }],
    });
    expect(s2.cashRefunds).toBe(0);
    expect(s2.expected).toBe(50);
  });

  it('excludes voided sales from the drawer', async () => {
    await store.openDrawer({ float: 10 });
    const sale = await store.completeSale({ lines: line(20), payment: { method: 'cash' } });
    expect((await store.drawerSummary()).expected).toBe(30);
    await store.voidSale(sale.id, sale.date);
    expect((await store.drawerSummary()).expected).toBe(10);
  });

  it('reports an unopened day without inventing a float', async () => {
    await store.completeSale({ lines: line(15), payment: { method: 'cash' } });
    const s = await store.drawerSummary();
    expect(s.opened).toBe(false);
    expect(s.float).toBe(0);
    expect(s.cashSales).toBe(15);
    expect(s.expected).toBe(15);
  });
});

describe('drawer lifecycle', () => {
  it('opens once, and refuses to open twice', async () => {
    await store.openDrawer({ float: 75.5 });
    expect((await store.drawerDay(today())).float).toBe(75.5);
    await expect(store.openDrawer({ float: 10 })).rejects.toThrow(/already started/);
  });

  it('refuses movements before the day is started, and after it is closed', async () => {
    await expect(store.addCashMovement({ amount: 5 })).rejects.toThrow(/Start the day/);
    await store.openDrawer({ float: 10 });
    await expect(store.addCashMovement({ amount: 0 })).rejects.toThrow(/Enter an amount/);
    await store.addCashMovement({ amount: -5, reason: 'Milk' });
    await store.closeDrawer({ counted: 5 });
    await expect(store.addCashMovement({ amount: 5 })).rejects.toThrow(/already closed/);
  });

  it('records the count, the difference, and a snapshot of the day', async () => {
    await store.openDrawer({ float: 100 });
    await store.completeSale({ lines: line(20), payment: { method: 'cash' } });
    await store.completeSale({ lines: line(35), payment: { method: 'card' } });
    const day = await store.closeDrawer({ counted: 118 });

    expect(day.close.expected).toBe(120);
    expect(day.close.counted).toBe(118);
    expect(day.close.diff).toBe(-2);
    expect(day.close.salesCount).toBe(2);
    expect(day.close.revenue).toBe(55);
    expect(day.close.cashSales).toBe(20);
    expect(day.close.byMethod).toHaveLength(2);
    expect(day.close.currency).toBe('USD');
    expect(overShortLabel(day.close.diff, money)).toBe('Short $2.00');

    await expect(store.closeDrawer({ counted: 120 })).rejects.toThrow(/already closed/);
  });

  it('keeps a closed report from being rewritten by a later refund', async () => {
    await store.openDrawer({ float: 0 });
    const sale = await store.completeSale({ lines: line(50), payment: { method: 'cash' } });
    const day = await store.closeDrawer({ counted: 50 });
    expect(day.close.diff).toBe(0);

    await store.refundSale({ receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }], method: 'cash' });
    const after = await store.drawerDay(today());
    expect(after.close.expected).toBe(50);
    expect(after.close.cashRefunds).toBe(0);
    expect(after.close.diff).toBe(0);
  });

  it('can close a day that was left open, without touching today', async () => {
    // Yesterday, opened and never closed.
    const yesterday = todayISO(new Date(Date.now() - 24 * 3600 * 1000));
    await store.openDrawer({ date: yesterday, float: 40 });
    await store.openDrawer({ date: today(), float: 60 });

    const closed = await store.closeDrawer({ date: yesterday, counted: 38 });
    expect(closed.close.diff).toBe(-2);
    expect((await store.drawerDay(today())).close).toBeUndefined();

    const open = (await store.drawerDaysInRange(yesterday, today())).filter((d) => !d.close);
    expect(open.map((d) => d.date)).toEqual([today()]);
  });

  it('refuses to close a day that was never started', async () => {
    await expect(store.closeDrawer({ counted: 10 })).rejects.toThrow(/never started/);
  });

  it('persists across a reload and indexes its month', async () => {
    await store.openDrawer({ float: 30 });
    await store.addCashMovement({ amount: -4, reason: 'Milk' });
    await store.closeDrawer({ counted: 26 });

    const key = monthKeyOf(today());
    expect(store.drawerMonths).toContain(key);
    expect(mock.files.has(`pos-data/drawer-${key}.json`)).toBe(true);

    const reloaded = new Store();
    await reloaded.init();
    const day = await reloaded.drawerDay(today());
    expect(day.close.counted).toBe(26);
    expect(day.movements).toHaveLength(1);
    expect(await reloaded.drawerDay('1999-01-01')).toBeNull();
  });

  it('rolls back a day whose write fails', async () => {
    mock.failNextFsWrite();
    await expect(store.openDrawer({ float: 50 })).rejects.toThrow();
    expect(await store.drawerDay(today())).toBeNull();

    await store.openDrawer({ float: 50 });
    mock.failNextFsWrite();
    await expect(store.addCashMovement({ amount: -5 })).rejects.toThrow();
    expect((await store.drawerDay(today())).movements).toEqual([]);
  });
});

describe('drawer data in backups', () => {
  it('round-trips through export and import', async () => {
    await store.openDrawer({ float: 80 });
    await store.addCashMovement({ amount: -9, reason: 'Courier' });
    await store.closeDrawer({ counted: 71 });
    const backup = await store.exportAll();
    expect(Object.keys(backup.drawers)).toEqual([monthKeyOf(today())]);

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(backup);
    const day = await fresh.drawerDay(today());
    expect(day.close.counted).toBe(71);
    expect(day.movements[0].reason).toBe('Courier');
  });

  it('a wipe removes drawer files with the rest of the dataset', async () => {
    await store.openDrawer({ float: 80 });
    const file = `pos-data/drawer-${monthKeyOf(today())}.json`;
    expect(mock.files.has(file)).toBe(true);

    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings },
      products: [], categories: [], taxes: [], discounts: [], sales: {},
    });
    expect(store.drawerMonths).toEqual([]);
    expect(mock.files.has(file)).toBe(false);
    expect(await store.drawerDay(today())).toBeNull();
  });

  it('refuses a backup whose drawer history is damaged', async () => {
    await expect(store.importAll({
      app: 'point-of-sale', version: 1, settings: {}, sales: {}, drawers: { 'nope': [] },
    })).rejects.toThrow(/Drawer history/);
    await expect(store.importAll({
      app: 'point-of-sale', version: 1, settings: {}, sales: {}, drawers: { '2026-08': 'x' },
    })).rejects.toThrow(/Drawer history/);
  });
});

describe('sample dataset drawer days', () => {
  it('ships closed days whose expected cash matches its own sales', async () => {
    const data = sampleDataset({ settings: { currency: 'USD', theme: 'system' } });
    const days = Object.values(data.drawers).flat();
    expect(days.length).toBeGreaterThan(5);

    const receipts = Object.values(data.sales).flat();
    for (const day of days) {
      expect(day.close).toBeTruthy();
      const cash = receipts.filter((r) => r.date === day.date)
        .flatMap((r) => r.payments.filter((p) => p.method === 'cash'))
        .reduce((a, p) => a + p.amount, 0);
      expect(day.close.cashSales).toBeCloseTo(cash, 2);
      expect(day.close.expected).toBeCloseTo(
        day.close.float + day.close.cashSales + day.close.paidIn - day.close.paidOut, 2,
      );
      expect(day.close.diff).toBeCloseTo(day.close.counted - day.close.expected, 2);
    }
  });
});
