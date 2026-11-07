import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { monthKeyOf, todayISO } from '../src/lib/dates.js';

let mock;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => {
  mock.uninstall();
});

describe('init', () => {
  it('seeds default settings on first run', () => {
    expect(store.settings.currency).toBe('USD');
    expect(store.settings.nextReceipt).toBe(1001);
    expect(store.settings.onboarded).toBe(false);
    expect(mock.kv.has('pos:settings:v1')).toBe(true);
  });

  it('reads back what it wrote', async () => {
    await store.updateSettings({ storeName: 'Test Shop', currency: 'EUR' });
    const second = new Store();
    await second.init();
    expect(second.settings.storeName).toBe('Test Shop');
    expect(second.settings.currency).toBe('EUR');
  });
});

describe('the month index', () => {
  it('refuses a key that isn’t a month, so nothing else can name a file', async () => {
    // Month keys become path segments (pos-data/sales-<key>.json). The
    // drawer, stock and stocktake indexes have always been filtered on the
    // way in, and so has the offline-boot snapshot; the sales index was not.
    mock.kv.set('pos:months:v1', JSON.stringify([
      '2026-07', '../../../secret', '2026-13', 'nonsense', '2026-08',
    ]));
    mock.kv.set('pos:drawers:v1', JSON.stringify(['../../../secret', '2026-08']));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.months).toEqual(['2026-08', '2026-07']);
    expect(fresh.drawerMonths).toEqual(['2026-08']);
    // And nothing goes looking for the file such a key would have named.
    await fresh.loadMonth('../../../secret');
    expect([...mock.files.keys()].some((f) => f.includes('secret'))).toBe(false);
  });
});

describe('an unreadable kv value', () => {
  it('boots on defaults but preserves the damaged bytes', async () => {
    await store.updateSettings({ storeName: 'Corner Roast' });
    mock.kv.set('pos:settings:v1', '{"storeName":"Corner Ro');   // truncated

    const fresh = new Store();
    await fresh.init();
    expect(fresh.settings.storeName).toBe('');   // defaults, not a crash

    // The only copy was not written over, and a spare copy was parked.
    expect(mock.kv.get('pos:settings:v1')).toBe('{"storeName":"Corner Ro');
    expect([...mock.kv.keys()].some((k) => k.startsWith('pos:settings:v1:corrupt:'))).toBe(true);
  });
});

describe('catalog', () => {
  it('adds and updates products with cleaned fields', async () => {
    const p = await store.addProduct({ name: '  Latte ', price: '4.60', slot: 3, trackStock: false });
    expect(p.name).toBe('Latte');
    expect(p.price).toBe(4.6);
    expect(p.stock).toBeNull();

    await store.updateProduct(p.id, { name: 'Latte', price: 5, slot: 3, trackStock: true, stock: 10 });
    expect(store.product(p.id).price).toBe(5);
    expect(store.product(p.id).stock).toBe(10);
  });

  it('delete returns a working undo', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    const { undo } = await store.deleteProduct(p.id);
    expect(store.product(p.id)).toBeNull();
    await undo();
    expect(store.product(p.id)).not.toBeNull();
  });

  /* Two delete toasts can stack, and each one's undo must speak only for
     its own product - not put back a whole-catalog snapshot that resurrects
     the other delete or erases a product added in the meantime. */
  it('undoing one delete does not undo another, or eat a newer product', async () => {
    const a = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    const b = await store.addProduct({ name: 'Tote', price: 18, slot: 2 });
    const undoA = (await store.deleteProduct(a.id)).undo;
    await store.deleteProduct(b.id);
    const c = await store.addProduct({ name: 'Tumbler', price: 24, slot: 3 });

    await undoA();
    expect(store.product(a.id)).not.toBeNull();   // A is back
    expect(store.product(b.id)).toBeNull();       // B stays deleted
    expect(store.product(c.id)).not.toBeNull();   // C survives the undo
    expect(store.products.map((p) => p.name)).toEqual(['Mug', 'Tumbler']);
  });

  it('undo is a no-op when the product is already back', async () => {
    const a = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    const { undo } = await store.deleteProduct(a.id);
    await undo();
    await undo();   // a second tap must not duplicate the product
    expect(store.products.filter((p) => p.id === a.id)).toHaveLength(1);
  });

  it('rolls back a delete whose write fails', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    mock.failNextKvSet();
    await expect(store.deleteProduct(p.id)).rejects.toThrow();
    expect(store.product(p.id)).not.toBeNull();
  });

  it('deleting a category orphans its products instead of deleting them', async () => {
    const cat = await store.addCategory('Drinks');
    const p = await store.addProduct({ name: 'Tea', price: 3, categoryId: cat.id, slot: 1 });
    await store.deleteCategory(cat.id);
    expect(store.category(cat.id)).toBeNull();
    expect(store.product(p.id).categoryId).toBeNull();
  });
});

/**
 * Edits land locally first so the app answers instantly, but a write the cloud
 * rejected has to be taken back off the screen: an unsaved product can be rung
 * up under an id nothing will match, an unsaved rate prices the next sale and
 * then vanishes on reload. Every one of these must leave the store exactly as a
 * fresh init() would find it.
 */
describe('a rejected write leaves nothing behind', () => {
  const fresh = async () => {
    const other = new Store();
    await other.init();
    return other;
  };

  it('undoes a product that could not be saved', async () => {
    mock.failNextKvSet();
    await expect(store.addProduct({ name: 'Ghost', price: 3, slot: 1 })).rejects.toThrow();
    expect(store.products).toHaveLength(0);
    expect((await fresh()).products).toHaveLength(0);
  });

  it('undoes a product edit that could not be saved', async () => {
    const p = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1 });
    mock.failNextKvSet();
    await expect(store.updateProduct(p.id, { name: 'Latte', price: 9.99, slot: 1 })).rejects.toThrow();
    expect(store.product(p.id).price).toBe(4.6);
    expect((await fresh()).product(p.id).price).toBe(4.6);
  });

  it('undoes a failed undo of a delete', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    const { undo } = await store.deleteProduct(p.id);
    mock.failNextKvSet();
    await expect(undo()).rejects.toThrow();
    expect(store.product(p.id)).toBeNull();   // still deleted, as the cloud has it
    expect((await fresh()).product(p.id)).toBeNull();
  });

  it('undoes a settings change that could not be saved', async () => {
    await store.updateSettings({ currency: 'EUR' });
    mock.failNextKvSet();
    await expect(store.updateSettings({ currency: 'JPY' })).rejects.toThrow();
    expect(store.settings.currency).toBe('EUR');
    expect((await fresh()).settings.currency).toBe('EUR');
  });

  it('undoes a tax rate that could not be saved, default and all', async () => {
    mock.failNextKvSet();
    await expect(store.addTax({ name: 'Sales tax', rate: 8 })).rejects.toThrow();
    expect(store.taxes).toHaveLength(0);
    expect(store.settings.defaultTaxId).toBeNull();
    expect((await fresh()).taxes).toHaveLength(0);
  });

  it('undoes a tax rate edit that could not be saved', async () => {
    const t = await store.addTax({ name: 'Sales tax', rate: 8 });
    mock.failNextKvSet();
    await expect(store.updateTax(t.id, { name: 'Sales tax', rate: 20 })).rejects.toThrow();
    expect(store.tax(t.id).rate).toBe(8);
    expect((await fresh()).tax(t.id).rate).toBe(8);
  });

  it('keeps a tax rate whose deletion could not be saved', async () => {
    const t = await store.addTax({ name: 'Sales tax', rate: 8 });
    const p = await store.addProduct({ name: 'X', price: 1, taxId: t.id, slot: 1 });
    mock.failNextKvSet();
    await expect(store.deleteTax(t.id)).rejects.toThrow();
    expect(store.tax(t.id)).not.toBeNull();
    expect(store.settings.defaultTaxId).toBe(t.id);
    expect(store.product(p.id).taxId).toBe(t.id);
  });

  it('rolls back only the collections the failed write touched', async () => {
    const t = await store.addTax({ name: 'Sales tax', rate: 8 });
    mock.failNextKvSet();
    const rejected = store.updateTax(t.id, { name: 'Sales tax', rate: 20 });
    // A sale completes while the tax write is in flight: the receipt counter
    // moves on. The failed edit must not drag it back - that would hand the
    // next sale a number that has already been issued.
    store.settings = { ...store.settings, nextReceipt: 2222 };
    await expect(rejected).rejects.toThrow();
    expect(store.tax(t.id).rate).toBe(8);
    expect(store.settings.nextReceipt).toBe(2222);
  });

  it('undoes a category, a rename, and a deletion that could not be saved', async () => {
    mock.failNextKvSet();
    await expect(store.addCategory('Drinks')).rejects.toThrow();
    expect(store.categories).toHaveLength(0);

    const cat = await store.addCategory('Drinks');
    mock.failNextKvSet();
    await expect(store.renameCategory(cat.id, 'Cold drinks')).rejects.toThrow();
    expect(store.category(cat.id).name).toBe('Drinks');

    const p = await store.addProduct({ name: 'Tea', price: 3, categoryId: cat.id, slot: 1 });
    mock.failNextKvSet();
    await expect(store.deleteCategory(cat.id)).rejects.toThrow();
    expect(store.category(cat.id)).not.toBeNull();
    expect(store.product(p.id).categoryId).toBe(cat.id);
  });

  it('undoes a discount preset that could not be saved', async () => {
    mock.failNextKvSet();
    await expect(store.addDiscount({ name: 'Staff', type: 'percent', value: 20 })).rejects.toThrow();
    expect(store.discounts).toHaveLength(0);

    const d = await store.addDiscount({ name: 'Staff', type: 'percent', value: 20 });
    mock.failNextKvSet();
    await expect(store.deleteDiscount(d.id)).rejects.toThrow();
    expect(store.discounts.map((x) => x.id)).toEqual([d.id]);
  });
});

describe('taxes', () => {
  it('the first tax becomes the default', async () => {
    const t = await store.addTax({ name: 'Sales tax', rate: 8.875 });
    expect(store.settings.defaultTaxId).toBe(t.id);
  });

  it('taxFor resolves own rate, default, and tax-free', async () => {
    const def = await store.addTax({ name: 'Standard', rate: 10 });
    const special = await store.addTax({ name: 'Reduced', rate: 5 });
    expect(store.taxFor({ taxId: null })?.id).toBe(def.id);
    expect(store.taxFor({ taxId: special.id })?.id).toBe(special.id);
    expect(store.taxFor({ taxId: 'none' })).toBeNull();
    // A dangling reference falls back to the default rather than exploding.
    expect(store.taxFor({ taxId: 'ghost' })?.id).toBe(def.id);
  });

  it('deleting the default promotes the next rate and resets products', async () => {
    const a = await store.addTax({ name: 'A', rate: 10 });
    const b = await store.addTax({ name: 'B', rate: 5 });
    const p = await store.addProduct({ name: 'X', price: 1, taxId: a.id, slot: 1 });
    await store.deleteTax(a.id);
    expect(store.settings.defaultTaxId).toBe(b.id);
    expect(store.product(p.id).taxId).toBeNull();
  });
});

describe('completeSale', () => {
  const lines = [{ productId: null, name: 'Latte', unitPrice: 4.6, qty: 2, taxRate: 10, taxName: 'Tax', discount: null }];

  it('stores a receipt with recomputed totals and bumps the number', async () => {
    const r = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(r.number).toBe(1001);
    expect(r.subtotal).toBe(9.2);
    expect(r.taxTotal).toBe(0.92);
    expect(r.total).toBe(10.12);
    expect(store.settings.nextReceipt).toBe(1002);

    const key = monthKeyOf(r.date);
    expect(store.months).toContain(key);
    const persisted = JSON.parse(mock.files.get(`pos-data/sales-${key}.json`));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(r.id);
  });

  it('computes cash change and rejects short tenders', async () => {
    const r = await store.completeSale({ lines, payment: { method: 'cash', tendered: 20 } });
    expect(r.payments).toEqual([{ method: 'cash', amount: 10.12, tendered: 20, change: 9.88 }]);
    await expect(store.completeSale({ lines, payment: { method: 'cash', tendered: 1 } }))
      .rejects.toThrow(/doesn.t cover/);
  });

  it('rejects an empty cart', async () => {
    await expect(store.completeSale({ lines: [], payment: { method: 'card' } }))
      .rejects.toThrow('Nothing to charge.');
  });

  it('decrements tracked stock, and voiding restores it', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    const sale = await store.completeSale({
      lines: [{ productId: p.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    expect(store.product(p.id).stock).toBe(3);

    await store.voidSale(sale.id, sale.date);
    expect(store.product(p.id).stock).toBe(5);
    const month = await store.loadMonth(monthKeyOf(sale.date));
    expect(month.find((s) => s.id === sale.id).voidedAt).toBeTruthy();
  });

  it('rolls back the optimistic insert when the write fails', async () => {
    mock.failNextFsWrite();
    await expect(store.completeSale({ lines, payment: { method: 'card' } })).rejects.toThrow();
    expect(store.settings.nextReceipt).toBe(1001);
    const month = await store.loadMonth(monthKeyOf(todayISO()));
    expect(month).toHaveLength(0);

    // The register retries cleanly after the transient failure.
    const r = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(r.number).toBe(1001);
  });

  it('voidSale is idempotent', async () => {
    const r = await store.completeSale({ lines, payment: { method: 'card' } });
    await store.voidSale(r.id, r.date);
    expect(await store.voidSale(r.id, r.date)).toBeNull();
  });

  it('sells by measure: decimal quantity, per-unit price, decimal stock', async () => {
    const p = await store.addProduct({
      name: 'Ham', price: 12, slot: 1, soldBy: 'measure', unit: 'kg',
      trackStock: true, stock: 5.5,
    });
    expect(p.soldBy).toBe('measure');
    expect(p.unit).toBe('kg');
    expect(p.stock).toBe(5.5);

    const sale = await store.completeSale({
      lines: [{ productId: p.id, name: 'Ham', unitPrice: 12, qty: 0.735, unit: 'kg', taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    expect(sale.total).toBe(8.82);
    expect(sale.lines[0].unit).toBe('kg');
    expect(sale.itemCount).toBe(1);
    expect(store.product(p.id).stock).toBe(4.765);

    await store.voidSale(sale.id, sale.date);
    expect(store.product(p.id).stock).toBe(5.5);
  });

  it('a measured product drops its option groups and defaults its unit', async () => {
    const p = await store.addProduct({
      name: 'Rope', price: 2, slot: 1, soldBy: 'measure', unit: '  ',
      options: [{ name: 'Color', choices: [{ name: 'Red', delta: 0 }] }],
    });
    expect(p.unit).toBe('unit');
    expect(p.options).toEqual([]);
    // Sold by the each stays exactly as before.
    const plain = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    expect(plain.soldBy).toBe('each');
    expect(plain.unit).toBe('');
  });

  it('snapshots the registration numbers in force at sale time', async () => {
    await store.updateSettings({ registrations: [{ label: 'VAT No.', number: 'GB 111' }] });
    const sale = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(sale.registrations).toEqual([{ label: 'VAT No.', number: 'GB 111' }]);

    // A later edit must not rewrite the issued receipt...
    await store.updateSettings({ registrations: [{ label: 'VAT No.', number: 'GB 999' }] });
    expect(sale.registrations).toEqual([{ label: 'VAT No.', number: 'GB 111' }]);

    // ...and the refund carries the identity of the day it happens.
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }],
    });
    expect(refund.registrations).toEqual([{ label: 'VAT No.', number: 'GB 999' }]);

    // With none configured, receipts carry nothing rather than an empty list.
    await store.updateSettings({ registrations: [] });
    const plain = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(plain.registrations).toBeUndefined();
  });

  it('never reissues last month’s numbers on the first sale of a new month', async () => {
    // Last month's file holds receipts up to 1003; the counter write that
    // went with them was lost, and the register reloaded reading 1001.
    const [y, m] = todayISO().split('-').map(Number);
    const prev = new Date(y, m - 2, 15);
    const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    mock.files.set(`pos-data/sales-${prevKey}.json`,
      JSON.stringify([{ id: 'old', number: 1003, date: `${prevKey}-15`, at: 1, total: 5, lines: [] }]));
    mock.kv.set('pos:months:v1', JSON.stringify([prevKey]));

    const fresh = new Store();
    await fresh.init();
    expect(fresh.settings.nextReceipt).toBe(1001);   // the stale counter came back

    const sale = await fresh.completeSale({ lines, payment: { method: 'card' } });
    expect(sale.number).toBe(1004);
  });

  it('never reissues a number the month already holds', async () => {
    const first = await store.completeSale({ lines, payment: { method: 'card' } });

    // The counter's own write after a sale is fire-and-forget; simulate it
    // being lost while the month file landed, then the app reloading.
    const stored = JSON.parse(mock.kv.get('pos:settings:v1'));
    mock.kv.set('pos:settings:v1', JSON.stringify({ ...stored, nextReceipt: 1001 }));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.settings.nextReceipt).toBe(1001);   // the stale counter came back

    const second = await fresh.completeSale({ lines, payment: { method: 'card' } });
    expect(second.number).toBe(first.number + 1);
    expect(fresh.settings.nextReceipt).toBe(second.number + 1);
  });
});

describe('a damaged month file', () => {
  const lines = [{ productId: null, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null }];

  it('is parked aside so selling continues, never overwritten in place', async () => {
    const first = await store.completeSale({ lines, payment: { method: 'card' } });
    const path = `pos-data/sales-${monthKeyOf(first.date)}.json`;
    mock.files.set(path, '[{"id":"x", tru');   // the cloud copy got truncated

    const fresh = new Store();
    await fresh.init();
    const sale = await fresh.completeSale({ lines, payment: { method: 'card' } });
    expect(sale.number).toBe(1002);

    // The damaged bytes were parked under a sibling name...
    const parked = [...mock.files.keys()].find((k) => k.startsWith(`${path}.corrupt-`));
    expect(mock.files.get(parked)).toBe('[{"id":"x", tru');
    // ...and the month file was rebuilt with the new sale.
    expect(JSON.parse(mock.files.get(path)).map((s) => s.id)).toEqual([sale.id]);
  });

  it('keeps the month dead if even the parking write fails', async () => {
    const first = await store.completeSale({ lines, payment: { method: 'card' } });
    const path = `pos-data/sales-${monthKeyOf(first.date)}.json`;
    mock.files.set(path, '[{"id":"x", tru');

    const fresh = new Store();
    await fresh.init();
    mock.failNextFsWrite();
    await expect(fresh.completeSale({ lines, payment: { method: 'card' } })).rejects.toThrow();
    expect(mock.files.get(path)).toBe('[{"id":"x", tru');   // untouched
  });

  /* Valid JSON in the wrong shape is damage too: read as an empty month it
     would be overwritten in place - the exact loss the parking exists to stop. */
  it('parks a month file holding valid JSON that is not an array', async () => {
    const first = await store.completeSale({ lines, payment: { method: 'card' } });
    const path = `pos-data/sales-${monthKeyOf(first.date)}.json`;
    mock.files.set(path, '{"sales":[{"id":"x"}]}');   // hand-wrapped by mistake

    const fresh = new Store();
    await fresh.init();
    const sale = await fresh.completeSale({ lines, payment: { method: 'card' } });

    const parked = [...mock.files.keys()].find((k) => k.startsWith(`${path}.corrupt-`));
    expect(mock.files.get(parked)).toBe('{"sales":[{"id":"x"}]}');
    expect(JSON.parse(mock.files.get(path)).map((s) => s.id)).toEqual([sale.id]);
  });

  it('fails a drawer month closed on the wrong shape instead of replacing it', async () => {
    const today = todayISO();
    await store.openDrawer({ date: today, float: 100 });
    const path = `pos-data/drawer-${monthKeyOf(today)}.json`;
    mock.files.set(path, '{"days":[]}');

    const fresh = new Store();
    await fresh.init();
    await expect(fresh.drawerDay(today)).rejects.toThrow();
    await expect(fresh.addCashMovement({ date: today, amount: 5 })).rejects.toThrow();
    expect(mock.files.get(path)).toBe('{"days":[]}');   // never overwritten
  });
});

/**
 * The month indexes tell the loaders which files exist. When an index is
 * lost or damaged, the files are still there - and a write that trusts the
 * broken index blindly would replace a whole month of history with today's
 * one record.
 */
describe('a lost or damaged month index', () => {
  const lines = [{ productId: null, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null }];
  const monthFile = () => `pos-data/sales-${monthKeyOf(todayISO())}.json`;

  it('is rebuilt from the data directory when the stored value is corrupt', async () => {
    const first = await store.completeSale({ lines, payment: { method: 'card' } });
    await store.openDrawer({ date: todayISO(), float: 50 });
    mock.kv.set('pos:months:v1', '["2026-0');       // truncated
    mock.kv.set('pos:drawers:v1', '{oops');

    const fresh = new Store();
    await fresh.init();
    expect(fresh.months).toContain(monthKeyOf(first.date));
    expect(fresh.drawerMonths).toContain(monthKeyOf(first.date));
    // The rebuilt index was written back, and history reads normally.
    expect(JSON.parse(mock.kv.get('pos:months:v1'))).toContain(monthKeyOf(first.date));
    expect((await fresh.loadMonth(monthKeyOf(first.date))).map((s) => s.id)).toEqual([first.id]);
    expect(await fresh.drawerDay(todayISO())).not.toBeNull();
  });

  it('a vanished index no longer lets one sale overwrite the month file', async () => {
    const first = await store.completeSale({ lines, payment: { method: 'card' } });
    mock.kv.delete('pos:months:v1');                // lost outright, not damaged

    const fresh = new Store();
    await fresh.init();
    expect(fresh.months).toHaveLength(0);           // the index really is gone
    const second = await fresh.completeSale({ lines, payment: { method: 'card' } });

    const ids = JSON.parse(mock.files.get(monthFile())).map((s) => s.id);
    expect(ids.sort()).toEqual([first.id, second.id].sort());
    // And the history the write absorbed is on screen, not just on disk.
    expect((await fresh.loadMonth(monthKeyOf(first.date))).map((s) => s.id).sort())
      .toEqual([first.id, second.id].sort());
  });

  it('a vanished drawer index no longer costs the month its earlier days', async () => {
    const past = '2026-01-05';
    await store.openDrawer({ date: past, float: 100 });
    mock.kv.delete('pos:drawers:v1');

    const fresh = new Store();
    await fresh.init();
    await fresh.openDrawer({ date: '2026-01-09', float: 80 });

    const days = JSON.parse(mock.files.get('pos-data/drawer-2026-01.json')).map((d) => d.date);
    expect(days.sort()).toEqual([past, '2026-01-09'].sort());
  });
});

describe('product photos', () => {
  it('stamps a version once the file has landed, and clears it on removal', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    expect(p.photo).toBeNull();

    const updated = await store.setProductPhoto(p.id, 'jpeg-bytes');
    expect(updated.photo).toBeGreaterThan(0);
    expect(mock.files.has(`pos-data/product-images/${p.id}.jpg`)).toBe(true);

    // A plain edit that carries the stamp through keeps it.
    const edited = await store.updateProduct(p.id, { name: 'Blue mug', price: 16, slot: 1, photo: updated.photo });
    expect(edited.photo).toBe(updated.photo);

    await store.removeProductPhoto(p.id);
    expect(store.product(p.id).photo).toBeNull();
    expect(mock.files.has(`pos-data/product-images/${p.id}.jpg`)).toBe(false);
  });

  it('does not stamp the catalog when the file write fails', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    mock.failNextFsWrite();
    await expect(store.setProductPhoto(p.id, 'jpeg-bytes')).rejects.toThrow();
    expect(store.product(p.id).photo).toBeNull();
  });

  it('readProductPhoto returns null for products without one', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
    expect(await store.readProductPhoto(p)).toBeNull();
    expect(await store.readProductPhoto(null)).toBeNull();
  });

  it('refuses to build a photo path out of an id from a restored backup', async () => {
    vi.useFakeTimers();
    try {
      mock.files.set('pos-data/keep-me.jpg', 'someone else’s file');
      await store.importAll({
        app: 'point-of-sale',
        version: 1,
        settings: { currency: 'USD' },
        // A hand-edited backup can carry any id at all; this one is a path.
        products: [{ id: '../keep-me', name: 'Trap', price: 1, photo: 1 }],
        sales: {},
      });
      const planted = store.product('../keep-me');
      expect(planted).not.toBeNull();

      // Reading it is "no picture", not a read of whatever sits at that path.
      expect(await store.readProductPhoto(planted)).toBeNull();
      // Writing one is refused outright rather than landing outside pos-data.
      await expect(store.setProductPhoto('../keep-me', 'jpeg-bytes')).rejects.toThrow();
      // And neither removal nor the post-delete purge follows the path out.
      await store.removeProductPhoto('../keep-me');
      await store.deleteProduct('../keep-me');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mock.files.get('pos-data/keep-me.jpg')).toBe('someone else’s file');
    } finally {
      vi.useRealTimers();
    }
  });

  it('purges the photo file once a delete is past undo - and only then', async () => {
    vi.useFakeTimers();
    try {
      const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1 });
      await store.setProductPhoto(p.id, 'jpeg-bytes');
      const path = `pos-data/product-images/${p.id}.jpg`;

      // Undone within the window: the picture is still there to come back to.
      const { undo } = await store.deleteProduct(p.id);
      await undo();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mock.files.has(path)).toBe(true);

      // Deleted for good: the file doesn't outlive the catalog row forever.
      await store.deleteProduct(p.id);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mock.files.has(path)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('customers', () => {
  const lines = [{ productId: null, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null }];

  it('adds, edits, and deletes directory entries', async () => {
    const c = await store.addCustomer({ name: '  Maya  ', phone: '555', email: 'm@x.com', note: 'oat' });
    expect(c).toMatchObject({ name: 'Maya', phone: '555', email: 'm@x.com', note: 'oat' });
    await store.updateCustomer(c.id, { name: 'Maya L.', phone: '', email: '', note: '' });
    expect(store.customer(c.id).name).toBe('Maya L.');
    await store.deleteCustomer(c.id);
    expect(store.customer(c.id)).toBeNull();
    await expect(store.addCustomer({ name: '  ' })).rejects.toThrow(/needs a name/);
  });

  it('a sale stores the id and a copy of the name; edits never rewrite it', async () => {
    const c = await store.addCustomer({ name: 'Maya' });
    const sale = await store.completeSale({ lines, payment: { method: 'card' }, customerId: c.id });
    expect(sale.customerId).toBe(c.id);
    expect(sale.customerName).toBe('Maya');

    await store.updateCustomer(c.id, { name: 'Maya Lindqvist' });
    expect(sale.customerName).toBe('Maya');

    // A refund follows the original's customer.
    const refund = await store.refundSale({ receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }] });
    expect(refund.customerId).toBe(c.id);
    expect(refund.customerName).toBe('Maya');

    // An id nothing matches attaches nothing rather than a ghost.
    const plain = await store.completeSale({ lines, payment: { method: 'card' }, customerId: 'gone' });
    expect(plain.customerId).toBeUndefined();
  });

  it('salesForCustomer walks month files and reports where to continue', async () => {
    const c = await store.addCustomer({ name: 'Tom' });
    await store.completeSale({ lines, payment: { method: 'card' }, customerId: c.id });
    await store.completeSale({ lines, payment: { method: 'card' } });
    const { sales, exhausted } = await store.salesForCustomer(c.id);
    expect(sales).toHaveLength(1);
    expect(sales[0].customerName).toBe('Tom');
    expect(exhausted).toBe(true);
  });

  it('customers travel through backup and restore', async () => {
    await store.addCustomer({ name: 'Maya' });
    const data = await store.exportAll();
    expect(data.customers).toHaveLength(1);
    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    expect(fresh.customers).toHaveLength(1);
    expect(fresh.customers[0].name).toBe('Maya');
  });
});

describe('stock adjustments and the movement ledger', () => {
  const lineFor = (p, qty = 1) => [{
    productId: p.id, name: p.name, unitPrice: p.price, qty,
    taxRate: 0, taxName: '', discount: null,
  }];

  it('adjustStock moves the level and files a ledger entry', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    const entry = await store.adjustStock({ productId: p.id, delta: 12, reason: 'received', note: 'Tuesday delivery' });
    expect(store.product(p.id).stock).toBe(17);
    expect(entry).toMatchObject({ reason: 'received', delta: 12, level: 17, note: 'Tuesday delivery' });

    const moves = await store.stockMovementsFor(p.id);
    expect(moves).toHaveLength(1);
    expect(moves[0].id).toBe(entry.id);

    // Damage subtracts; an unknown reason files as 'other'.
    await store.adjustStock({ productId: p.id, delta: -2, reason: 'damage' });
    expect(store.product(p.id).stock).toBe(15);
    const later = await store.adjustStock({ productId: p.id, delta: 1, reason: 'bogus' });
    expect(later.reason).toBe('other');
  });

  it('refuses a zero movement and untracked products', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    await expect(store.adjustStock({ productId: p.id, delta: 0 })).rejects.toThrow('Enter an amount.');
    const loose = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1 });
    await expect(store.adjustStock({ productId: loose.id, delta: 1 })).rejects.toThrow(/track stock/);
  });

  it('rolls the level back when the product write fails, and drops the entry', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    mock.failNextKvSet();
    await expect(store.adjustStock({ productId: p.id, delta: 3, reason: 'received' })).rejects.toThrow();
    expect(store.product(p.id).stock).toBe(5);
    expect(await store.stockMovementsFor(p.id)).toHaveLength(0);
  });

  /* The adjustment reads the level, then awaits its ledger write; a sale can
     land in that window. The change is a delta, and it must apply to the
     level as it stands when it commits - an absolute write computed before
     the await would put the sold units back on the shelf. */
  it('an adjustment racing a sale keeps the sale\'s decrement', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    const stockPath = (path) => path.startsWith('pos-data/stock-');

    let release;
    const gate = new Promise((r) => { release = r; });
    const realWrite = puter.fs.write;
    let held = false;
    puter.fs.write = async (path, data) => {
      if (stockPath(path) && !held) { held = true; await gate; }
      return realWrite(path, data);
    };

    const adjusting = store.adjustStock({ productId: p.id, delta: 3, reason: 'received' });
    await new Promise((r) => setTimeout(r, 5));                 // ledger write now in flight
    await store.completeSale({ lines: lineFor(p, 2), payment: { method: 'card' } });
    expect(store.product(p.id).stock).toBe(3);                  // the sale sold 2
    release();
    const entry = await adjusting;
    puter.fs.write = realWrite;

    expect(store.product(p.id).stock).toBe(6);                  // 3 + 3, not 5 + 3
    expect(entry.level).toBe(6);                                // the ledger tells the truth
    const stored = JSON.parse(mock.kv.get('pos:products:v1')).find((x) => x.id === p.id);
    expect(stored.stock).toBe(6);
  });

  it('sales, refunds, and voids write their own movements', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    const sale = await store.completeSale({ lines: lineFor(p, 2), payment: { method: 'card' } });
    await store.refundSale({ receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 1 }], restock: true });
    const second = await store.completeSale({ lines: lineFor(p, 1), payment: { method: 'card' } });
    await store.voidSale(second.id, second.date);
    // Ledger appends are deliberately fire-and-forget; let them settle.
    await new Promise((r) => setTimeout(r, 0));

    const moves = await store.stockMovementsFor(p.id);
    expect(moves.map((m) => [m.reason, m.delta, m.level])).toEqual([
      ['void', 1, 4],
      ['sale', -1, 3],
      ['refund', 1, 4],
      ['sale', -2, 3],
    ]);
    expect(moves[0].receiptNumber).toBe(second.number);
  });

  it('the ledger travels through backup and restore', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    await store.adjustStock({ productId: p.id, delta: 7, reason: 'received' });
    const data = await store.exportAll();
    expect(Object.values(data.stockMovements).flat()).toHaveLength(1);

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    const moves = await fresh.stockMovementsFor(p.id);
    expect(moves).toHaveLength(1);
    expect(moves[0].delta).toBe(7);
  });

  it('per-product low-stock threshold survives cleaning', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5, lowStock: 10 });
    expect(p.lowStock).toBe(10);
    const off = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1 });
    expect(off.lowStock).toBeNull();
  });
});

describe('salesInRange', () => {
  it('filters by date and excludes nothing by itself', async () => {
    const lines = [{ productId: null, name: 'X', unitPrice: 1, qty: 1, taxRate: 0, taxName: '', discount: null }];
    await store.completeSale({ lines, payment: { method: 'card' } });
    const today = todayISO();
    expect(await store.salesInRange(today, today)).toHaveLength(1);
    expect(await store.salesInRange('2000-01-01', '2000-01-02')).toHaveLength(0);
  });
});

describe('import/export', () => {
  it('round-trips the whole dataset', async () => {
    await store.addTax({ name: 'Tax', rate: 5 });
    await store.addProduct({ name: 'Latte', price: 4.6, slot: 1 });
    await store.completeSale({
      lines: [{ productId: null, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 5, taxName: 'Tax', discount: null }],
      payment: { method: 'card' },
    });
    const data = await store.exportAll();
    expect(data.app).toBe('point-of-sale');

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    expect(fresh.products).toHaveLength(1);
    expect(fresh.months).toEqual(store.months);
    expect((await fresh.loadMonth(fresh.months[0]))).toHaveLength(1);
  });

  it('rejects foreign data', async () => {
    await expect(store.importAll({ app: 'other' })).rejects.toThrow(/Not a Point of Sale export/);
  });

  /* The writes are phased - files, then the indexes that name them, then
     collections, then settings - so a restore that dies part-way leaves the
     old dataset fully reachable instead of a half-imported blend. */
  it('a restore that fails writing its files leaves the old dataset intact', async () => {
    const sale = await store.completeSale({
      lines: [{ productId: null, name: 'X', unitPrice: 1, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    const oldKey = monthKeyOf(sale.date);
    const backupMonth = oldKey === '2026-01' ? '2026-02' : '2026-01';

    // A restore takes an automatic snapshot first, which would absorb the
    // one failed write this case is about. Turned off so the failure lands
    // where the test aims it - the restore's own files.
    await store.updateSettings({ autoSnapshot: false });
    mock.failNextFsWrite();
    await expect(store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings, storeName: 'Blended' },
      products: [{ id: 'new-p', name: 'New', price: 1 }],
      categories: [], taxes: [], discounts: [],
      sales: { [backupMonth]: [{ id: 'new-sale', number: 1, date: `${backupMonth}-10`, at: 1, lines: [], total: 1 }] },
    })).rejects.toThrow();

    // Nothing was re-pointed: the index, catalog, and settings all still
    // describe the old dataset, in the cloud and in memory.
    expect(JSON.parse(mock.kv.get('pos:months:v1'))).toEqual([oldKey]);
    expect(JSON.parse(mock.kv.get('pos:settings:v1')).storeName).not.toBe('Blended');
    expect(store.months).toEqual([oldKey]);
    expect((await store.loadMonth(oldKey)).map((s) => s.id)).toEqual([sale.id]);
  });

  it('importing an empty dataset removes old months (the sample wipe)', async () => {
    await store.completeSale({
      lines: [{ productId: null, name: 'X', unitPrice: 1, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    const monthFile = `pos-data/sales-${store.months[0]}.json`;
    expect(mock.files.has(monthFile)).toBe(true);

    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings, sampleData: false },
      products: [], categories: [], taxes: [], discounts: [], sales: {},
    });
    expect(store.months).toEqual([]);
    expect(mock.files.has(monthFile)).toBe(false);
    expect(await store.salesInRange('2000-01-01', '2099-01-01')).toEqual([]);
  });

  /* A PIN record hashes a 4-6 digit code - any holder of the backup file
     searches that space in moments. It stays home; and a foreign backup's
     record must not lock this register behind a code nobody here set. */
  it('keeps the manager PIN out of backups, and the local one through a restore', async () => {
    await store.updateSettings({ pin: { salt: 'local-salt', hash: 'local-hash' } });
    const backup = await store.exportAll();
    expect(backup.settings.pin).toBeUndefined();

    await store.importAll({
      ...backup,
      settings: { ...backup.settings, pin: { salt: 'foreign', hash: 'foreign' } },
    });
    expect(store.settings.pin).toEqual({ salt: 'local-salt', hash: 'local-hash' });
    expect(JSON.parse(mock.kv.get('pos:settings:v1')).pin).toEqual({ salt: 'local-salt', hash: 'local-hash' });
  });

  it('keeps the receipt counter a number, whatever the backup holds', async () => {
    // "2001" + 1 would concatenate to "20011" and numbering never recovers.
    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings, nextReceipt: '2001' },
      products: [], categories: [], taxes: [], discounts: [], sales: {},
    });
    const receipt = await store.completeSale({
      lines: [{ productId: null, name: 'X', unitPrice: 1, qty: 1, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'card' },
    });
    expect(receipt.number).toBe(2001);
    expect(store.settings.nextReceipt).toBe(2002);
  });

  it('continues numbering above the restored history when the counter is unusable', async () => {
    const month = '2026-07';
    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings, nextReceipt: 'not a number' },
      products: [], categories: [], taxes: [], discounts: [],
      sales: { [month]: [{ id: 'a', number: 4880, date: `${month}-15`, at: 1, lines: [], total: 1 }] },
    });
    expect(store.settings.nextReceipt).toBe(4881);
  });

  /* importAll replaces the whole dataset before anything renders it, so a
     hand-edited backup's wrong-typed fields (a numeric name, an options
     string) must be coerced here - after the restore they would crash the
     catalog sort, the avatar initial, and the register's option picker. */
  it('normalizes wrong-typed records instead of installing them', async () => {
    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings },
      products: [
        { id: 'p1', name: 42, price: '4.60', stock: 7, options: 'junk', createdAt: 5 },
        { id: 'p2', name: 'Loose leaf', price: 3, stock: null },
      ],
      categories: [{ id: 'k1', name: 9 }],
      taxes: [{ id: 't1', name: 8, rate: '7.75' }],
      discounts: [{ id: 'd1', name: null, type: 'bogus', value: '10' }],
      customers: [{ id: 'c1', name: 7, phone: 555 }, { id: 'c2', name: '' }],
      sales: {},
    });

    const p1 = store.product('p1');
    expect(p1.name).toBe('42');
    expect(p1.price).toBe(4.6);
    expect(p1.stock).toBe(7);          // a stored level still means tracked stock
    expect(p1.options).toEqual([]);    // junk options can't crash the picker
    expect(p1.createdAt).toBe(5);
    expect(store.product('p2').stock).toBeNull();
    expect(store.customer('c1')).toMatchObject({ name: '7', phone: '555' });
    expect(store.customer('c2')).toBeNull();   // still no nameless customers
    expect(store.categories[0].name).toBe('9');
    expect(store.taxes[0]).toMatchObject({ name: '8', rate: 7.75 });
    expect(store.discounts[0].type).toBe('percent');

    // The exact expressions the views run must hold on everything imported.
    expect(() => [...store.products].sort((a, b) => a.name.localeCompare(b.name))).not.toThrow();
    expect(() => store.customers.map((c) => c.name.charAt(0).toUpperCase())).not.toThrow();
  });

  it('a real backup round-trips unchanged through the normalization', async () => {
    const cat = await store.addCategory('Beans');
    const p = await store.addProduct({
      name: 'House blend', price: 14, slot: 7, sku: 'BEAN-HB', categoryId: cat.id,
      trackStock: true, stock: 24, lowStock: 6,
      options: [{ name: 'Grind', required: true, multi: false, choices: [{ name: 'Whole', delta: 0 }, { name: 'Espresso', delta: 0.5 }] }],
    });
    const scale = await store.addProduct({
      name: 'Ham', price: 12, slot: 2, soldBy: 'measure', unit: 'kg', trackStock: true, stock: 3.25,
    });
    await store.addCustomer({ name: 'Maya Lindqvist', phone: '555-0142' });
    const backup = await store.exportAll();

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(backup);
    expect(fresh.product(p.id)).toEqual(store.product(p.id));
    expect(fresh.product(scale.id)).toEqual(store.product(scale.id));
    expect(fresh.customers).toEqual(store.customers);
    expect(fresh.categories).toEqual(store.categories);
  });

  it('announces a dataset replacement, so live views drop working copies', async () => {
    // The register keeps its open cart outside the store; without this event
    // a sample-data wipe left those lines alive, and the next render saved
    // them as the new dataset's draft, product ids dangling.
    let replaced = 0;
    store.addEventListener('replace', () => { replaced++; });
    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings },
      products: [], categories: [], taxes: [], discounts: [], sales: {},
    });
    expect(replaced).toBe(1);
  });

  it('heals a corrupted stored counter on boot', async () => {
    mock.kv.set('pos:settings:v1', JSON.stringify({ ...store.settings, nextReceipt: '3007' }));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.settings.nextReceipt).toBe(3007);
  });
});
