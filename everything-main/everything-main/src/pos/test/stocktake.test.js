import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter, installMockStorage } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { monthKeyOf, todayISO } from '../src/lib/dates.js';
import { parseCount, signed } from '../src/ui/stocktake.js';

let mock;
let storage;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  storage = installMockStorage();
  store = new Store();
  await store.init();
});

afterEach(() => {
  mock.uninstall();
  storage.uninstall();
});

/** Mugs (12 @ $7.50 cost), beans (24 @ $8.20), and an untracked latte. */
async function catalog() {
  const merch = await store.addCategory('Merch');
  const mug = await store.addProduct({
    name: 'Ceramic mug', price: 16, cost: 7.5, sku: 'MUG', categoryId: merch.id, trackStock: true, stock: 12,
  });
  const beans = await store.addProduct({
    name: 'House blend', price: 14, cost: 8.2, sku: 'BEAN', trackStock: true, stock: 24,
  });
  const latte = await store.addProduct({ name: 'Latte', price: 4.6 });
  return { merch, mug, beans, latte };
}

describe('the count sheet', () => {
  it('covers tracked products only, and a category when scoped to one', async () => {
    const { merch, mug } = await catalog();
    await store.startStocktake({});
    expect(store.stocktakeScope().map((p) => p.name)).toEqual(['Ceramic mug', 'House blend']);

    await store.cancelStocktake();
    await store.startStocktake({ categoryId: merch.id });
    expect(store.stocktakeScope().map((p) => p.id)).toEqual([mug.id]);
  });

  it('records counted quantities and survives a reload', async () => {
    const { mug } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 10);
    await store.flushStocktake();

    const fresh = new Store();
    await fresh.init();
    expect(fresh.stocktake.counts[mug.id]).toMatchObject({ counted: 10, expected: 12 });
  });

  it('clears one count without disturbing the rest', async () => {
    const { mug, beans } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 10);
    store.queueStocktakeCount(beans.id, 24);
    store.queueStocktakeCount(mug.id, null);
    expect(Object.keys(store.stocktake.counts)).toEqual([beans.id]);
  });

  it('refuses to bury a count already open', async () => {
    await catalog();
    await store.startStocktake({});
    await expect(store.startStocktake({})).rejects.toThrow(/already open/);
  });
});

describe('stocktakePlan', () => {
  it('prices the variance in units and in money', async () => {
    const { mug, beans } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 10);      // −2 at 7.50 = −15.00
    store.queueStocktakeCount(beans.id, 25);    // +1 at 8.20 = +8.20
    const plan = store.stocktakePlan();
    expect(plan.counted).toBe(2);
    expect(plan.variances).toHaveLength(2);
    expect(plan.unitsShort).toBe(2);
    expect(plan.unitsOver).toBe(1);
    expect(plan.value).toBe(-6.8);
    expect(plan.skipped).toBe(0);
  });

  it('leaves a variance without a cost out of the money, and says so', async () => {
    const { mug } = await catalog();
    await store.updateProduct(mug.id, { name: 'Ceramic mug', price: 16, trackStock: true, stock: 12 });
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 9);
    const plan = store.stocktakePlan();
    expect(plan.value).toBe(0);
    expect(plan.unknownCost).toBe(1);
    expect(plan.variances[0].value).toBeNull();
  });

  it('counts what wasn’t counted', async () => {
    const { mug } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 12);
    const plan = store.stocktakePlan();
    expect(plan.counted).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(plan.variances).toHaveLength(0);
  });
});

describe('postStocktake', () => {
  it('posts every variance at once, into the levels and the ledger', async () => {
    const { mug, beans } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 10);
    store.queueStocktakeCount(beans.id, 24);   // no variance
    const record = await store.postStocktake();

    expect(store.product(mug.id).stock).toBe(10);
    expect(store.product(beans.id).stock).toBe(24);
    expect(store.stocktake).toBeNull();
    expect(record).toMatchObject({ counted: 2, varianceCount: 1, value: -15 });

    // One ledger line, with the session's id, so the product's own history
    // explains where the two mugs went.
    const moves = await store.stockMovementsFor(mug.id);
    expect(moves[0]).toMatchObject({ reason: 'stocktake', delta: -2, level: 10, sessionId: record.id });
    expect(await store.stockMovementsFor(beans.id)).toHaveLength(0);
  });

  it('keeps a sale rung up during the count', async () => {
    const { mug } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 10);     // counted 10 against 12
    // Someone buys one while the sheet is open: the shelf is now 11 by the
    // app's reckoning, and 9 in the world.
    await store.completeSale({
      lines: [{ productId: mug.id, name: 'Ceramic mug', unitPrice: 16, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'cash', tendered: 20 },
    });
    expect(store.product(mug.id).stock).toBe(11);
    await store.postStocktake();
    expect(store.product(mug.id).stock).toBe(9);
  });

  it('files the count even when nothing varies, so the shop has a record', async () => {
    const { mug } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 12);
    const record = await store.postStocktake();
    expect(record.varianceCount).toBe(0);
    const filed = await store.loadStocktakeMonth(monthKeyOf(todayISO()));
    expect(filed.map((r) => r.id)).toEqual([record.id]);
  });

  it('refuses an empty count and a session already posted', async () => {
    const { mug } = await catalog();
    await store.startStocktake({});
    await expect(store.postStocktake()).rejects.toThrow(/counted yet/);
    store.queueStocktakeCount(mug.id, 11);
    const record = await store.postStocktake();
    await expect(store.postStocktake()).rejects.toThrow(/no open count/);

    // Another device left the same session open: posting it again would
    // apply every variance twice.
    store.stocktake = { ...record, counts: { [mug.id]: { counted: 11, expected: 12, at: Date.now() } } };
    await expect(store.postStocktake()).rejects.toThrow(/already been posted/);
  });

  it('never resumes a session this device has posted', async () => {
    const { mug } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 11);
    const record = await store.postStocktake();
    // The clearing write is fire-and-forget; simulate it never landing.
    await store.flushStocktake.call(store);
    mock.kv.set('pos:stocktake:v1', JSON.stringify({
      id: record.id, startedAt: Date.now(), counts: { [mug.id]: { counted: 11, expected: 12 } },
    }));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.stocktake).toBeNull();
  });

  it('rolls the whole post back if the levels write fails', async () => {
    const { mug } = await catalog();
    // Posting takes an automatic snapshot first, whose index write would
    // absorb the one failed kv write this case is about.
    await store.updateSettings({ autoSnapshot: false });
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 10);
    mock.failNextKvSet();
    await expect(store.postStocktake()).rejects.toThrow();
    expect(store.product(mug.id).stock).toBe(12);
    expect(store.stocktake).not.toBeNull();
    const filed = await store.loadStocktakeMonth(monthKeyOf(todayISO()));
    expect(filed).toHaveLength(0);
  });

  it('travels in a backup', async () => {
    const { mug } = await catalog();
    await store.startStocktake({});
    store.queueStocktakeCount(mug.id, 10);
    const record = await store.postStocktake();

    const data = await store.exportAll();
    expect(Object.values(data.stocktakes).flat().map((r) => r.id)).toEqual([record.id]);

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    const filed = await fresh.loadStocktakeMonth(monthKeyOf(todayISO()));
    expect(filed[0]).toMatchObject({ id: record.id, varianceCount: 1 });
    // The open session belonged to the dataset that was replaced.
    expect(fresh.stocktake).toBeNull();
  });
});

describe('parseCount', () => {
  it('reads a count, and refuses what is not one', () => {
    expect(parseCount('6')).toBe(6);
    expect(parseCount('')).toBeNull();
    expect(parseCount('0')).toBe(0);
    expect(parseCount('2,5', { measured: true })).toBe(2.5);
    expect(parseCount('2.5')).toBe(3);            // whole units round
    expect(Number.isNaN(parseCount('six'))).toBe(true);
    expect(Number.isNaN(parseCount('-3'))).toBe(true);
  });
});

describe('signed', () => {
  it('always wears a sign, and the app’s own minus', () => {
    expect(signed(-2)).toBe('−2');
    expect(signed(3, 'kg')).toBe('+3 kg');
    expect(signed(0)).toBe('+0');
  });
});
