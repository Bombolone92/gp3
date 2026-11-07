import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { summarizeBackup, readBackupFile, BackupError } from '../src/lib/backup.js';
import { installMockPuter, installMockStorage } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { todayISO, monthKeyOf } from '../src/lib/dates.js';

const good = (over = {}) => ({
  app: 'point-of-sale',
  version: 1,
  settings: { storeName: 'Corner Roast', currency: 'EUR', nextReceipt: 1042 },
  products: [{ id: 'a' }, { id: 'b' }],
  categories: [{ id: 'c' }],
  taxes: [{ id: 't' }],
  discounts: [],
  sales: { '2026-07': [{ id: 's1' }, { id: 's2' }], '2026-08': [{ id: 's3' }] },
  ...over,
});

describe('summarizeBackup', () => {
  it('describes a well-formed backup', () => {
    const sum = summarizeBackup(good({ exportedAt: 1754300000000 }));
    expect(sum).toMatchObject({
      version: 1,
      storeName: 'Corner Roast',
      currency: 'EUR',
      nextReceipt: 1042,
      products: 2,
      categories: 1,
      taxes: 1,
      discounts: 0,
      receipts: 3,
      exportedAt: 1754300000000,
    });
    expect(sum.months).toEqual(['2026-07', '2026-08']);
  });

  it('treats a missing version as 1 and rejects newer ones', () => {
    expect(summarizeBackup(good({ version: undefined })).version).toBe(1);
    expect(() => summarizeBackup(good({ version: 2 }))).toThrow(/newer version/);
  });

  it('rejects foreign, empty, and non-object payloads', () => {
    for (const bad of [null, 42, 'nope', [], {}, { app: 'accountant' }]) {
      expect(() => summarizeBackup(bad)).toThrow(BackupError);
    }
  });

  it('rejects a backup with no settings', () => {
    expect(() => summarizeBackup(good({ settings: undefined }))).toThrow(/store settings/);
  });

  it('rejects damaged collections and sales shapes', () => {
    expect(() => summarizeBackup(good({ products: 'nope' }))).toThrow(BackupError);
    expect(() => summarizeBackup(good({ sales: [] }))).toThrow(BackupError);
    expect(() => summarizeBackup(good({ sales: { '2026-08': { id: 'x' } } }))).toThrow(BackupError);
  });

  it('rejects month keys that are not month keys', () => {
    for (const key of ['2026-13', '26-08', '2026-8', '../../etc/passwd', 'sales']) {
      expect(() => summarizeBackup(good({ sales: { [key]: [] } }))).toThrow(BackupError);
    }
  });

  it('accepts a backup with no sales at all', () => {
    const sum = summarizeBackup(good({ sales: undefined }));
    expect(sum.receipts).toBe(0);
    expect(sum.months).toEqual([]);
  });

  /* Drawer history names files exactly as sales months do, and importAll
     refuses damaged shapes - the preview must refuse them first. */
  it('counts drawer days and tolerates their absence', () => {
    expect(summarizeBackup(good()).drawerDays).toBe(0);
    const sum = summarizeBackup(good({
      drawers: { '2026-07': [{ date: '2026-07-30' }], '2026-08': [{ date: '2026-08-01' }, { date: '2026-08-02' }] },
    }));
    expect(sum.drawerDays).toBe(3);
  });

  it('rejects damaged drawer history the way importAll would', () => {
    expect(() => summarizeBackup(good({ drawers: [] }))).toThrow(BackupError);
    expect(() => summarizeBackup(good({ drawers: 'nope' }))).toThrow(BackupError);
    expect(() => summarizeBackup(good({ drawers: { '2026-08': { date: 'x' } } }))).toThrow(BackupError);
    for (const key of ['2026-13', '26-08', '../../etc/passwd', 'drawer']) {
      expect(() => summarizeBackup(good({ drawers: { [key]: [] } }))).toThrow(BackupError);
    }
  });
});

describe('readBackupFile', () => {
  const file = (text, name = 'b.json') => new File([text], name, { type: 'application/json' });

  it('parses and validates a file', async () => {
    const { data, summary } = await readBackupFile(file(JSON.stringify(good())));
    expect(data.app).toBe('point-of-sale');
    expect(summary.products).toBe(2);
  });

  it('rejects empty files and invalid JSON', async () => {
    await expect(readBackupFile(file(''))).rejects.toThrow(/empty/);
    await expect(readBackupFile(file('{oops'))).rejects.toThrow(/valid JSON/);
    await expect(readBackupFile(null)).rejects.toThrow(BackupError);
  });
});

describe('importAll hardening', () => {
  let mock;
  let store;

  beforeEach(async () => {
    mock = installMockPuter();
    store = new Store();
    await store.init();
  });
  afterEach(() => mock.uninstall());

  it('refuses month keys that would name a file we never designed', async () => {
    await expect(store.importAll(good({ sales: { '../evil': [] } }))).rejects.toThrow(/damaged/);
    expect(mock.files.size).toBe(0);
  });

  it('refuses a month whose receipts are not a list', async () => {
    await expect(store.importAll(good({ sales: { '2026-08': 'nope' } }))).rejects.toThrow(/damaged/);
  });

  /* The store's own text becomes the sidebar brand, the window title and the
     header of every receipt, and it rides in the settings entry every boot
     reads - so it is capped where it is typed. A restored backup has to obey
     the same ceiling; uncapped, it could plant a name no keyboard here could
     have entered. */
  it('holds restored store text to the same ceiling the fields do', async () => {
    await store.importAll(good({
      settings: {
        storeName: `  ${'A'.repeat(200)}  `,
        address: 'B'.repeat(500),
        receiptFooter: '  Thanks  ',
        currency: 'USD',
      },
    }));
    expect(store.settings.storeName).toBe('A'.repeat(60));
    expect(store.settings.address).toBe('B'.repeat(200));
    expect(store.settings.receiptFooter).toBe('Thanks');
  });

  it('sanitizes restored registration rows like the receipt path does', async () => {
    await store.importAll(good({
      settings: {
        currency: 'USD',
        registrations: [
          { label: '  VAT No. ', number: '  GB123  ' },
          { label: 'No number', number: '' },
          { label: 'ABN', number: '999' },
          { label: 'Third', number: '111' },
        ],
      },
    }));
    // Trimmed, the numberless row dropped, and capped at the two a receipt prints.
    expect(store.settings.registrations).toEqual([
      { label: 'VAT No.', number: 'GB123' },
      { label: 'ABN', number: '999' },
    ]);
  });

  /* The container checks pass a file whose records are junk - a null in a
     month, a product with no id. Written verbatim, those crash every later
     read of that month (after the old dataset is already gone). */
  it('drops junk records instead of restoring them', async () => {
    await store.importAll(good({
      products: [{ id: 'a', name: 'Latte', price: 4.6 }, null, { name: 'no id' }],
      categories: [null],
      customers: [{ id: 'c1', name: 'Ada' }, { id: 'c2' }, 'junk'],
      sales: { '2026-07': [null, { id: 's1', number: 7, at: 5, total: 12 }, 'junk', {}] },
      drawers: { '2026-07': [{ date: '2026-07-30' }, null, {}] },
      stockMovements: { '2026-07': [{ id: 'm1', at: 1 }, null, {}] },
    }));
    expect(store.products.map((p) => p.id)).toEqual(['a']);
    expect(store.categories).toEqual([]);
    expect(store.customers.map((c) => c.id)).toEqual(['c1']);
    const month = await store.loadMonth('2026-07');
    expect(month.map((s) => s.id)).toEqual(['s1']);
    // The files landed clean too - a reload reads them raw.
    expect(JSON.parse(mock.files.get('pos-data/sales-2026-07.json')).map((s) => s.id)).toEqual(['s1']);
    expect(JSON.parse(mock.files.get('pos-data/drawer-2026-07.json'))).toEqual([{ date: '2026-07-30' }]);
    expect(JSON.parse(mock.files.get('pos-data/stock-2026-07.json'))).toEqual([{ id: 'm1', at: 1 }]);
  });

  /* The app only ever stores the logo as a small data-URL image (the picker
     caps it). A crafted backup planting a remote URL would call home on
     every receipt render - so anything else is dropped, not installed. */
  it('installs only a logo the app could have stored itself', async () => {
    const inline = 'data:image/png;base64,iVBORw0KGgo=';
    await store.importAll(good({ settings: { storeName: 'x', logo: inline } }));
    expect(store.settings.logo).toBe(inline);

    await store.importAll(good({ settings: { storeName: 'x', logo: 'https://evil.example/pixel.png' } }));
    expect(store.settings.logo).toBe(null);

    const bloated = `data:image/png;base64,${'A'.repeat(70_000)}`;
    await store.importAll(good({ settings: { storeName: 'x', logo: bloated } }));
    expect(store.settings.logo).toBe(null);
  });

  it('reads a hand-damaged month file without giving up on the month', async () => {
    await store.importAll(good({ sales: {} }));
    mock.files.set('pos-data/sales-2026-06.json', JSON.stringify([null, { id: 'ok', at: 3 }, 'junk']));
    await store.importAll(good({ sales: { '2026-06': [{ id: 'ok', at: 3 }] } })).catch(() => {});
    const fresh = new Store();
    await fresh.init();
    const month = await fresh.loadMonth('2026-06');
    expect(month.map((s) => s.id)).toEqual(['ok']);
  });

  it('round-trips drawer history through export and restore', async () => {
    await store.openDrawer({ float: 80 });
    await store.closeDrawer({ counted: 80 });
    const backup = await store.exportAll();
    expect(summarizeBackup(backup).drawerDays).toBe(1);

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(backup);
    const day = await fresh.drawerDay(todayISO());
    expect(day?.float).toBe(80);
    expect(day?.close?.counted).toBe(80);
  });

  it('stamps exports with a date the preview can show', async () => {
    const data = await store.exportAll();
    expect(data.exportedAt).toBeGreaterThan(0);
    expect(summarizeBackup(data).exportedAt).toBe(data.exportedAt);
  });

  it('round-trips products, sales, and the receipt counter', async () => {
    await store.addTax({ name: 'Tax', rate: 5 });
    const p = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1 });
    await store.completeSale({
      lines: [{ productId: p.id, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 5, taxName: 'Tax', discount: null }],
      payment: { method: 'card' },
    });
    const backup = await store.exportAll();

    // Wipe, then restore from the backup.
    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings, nextReceipt: 1001 },
      products: [], categories: [], taxes: [], discounts: [], sales: {},
    });
    expect(store.products).toHaveLength(0);

    await store.importAll(backup);
    expect(store.products).toHaveLength(1);
    expect(store.settings.nextReceipt).toBe(1002);
    const month = await store.loadMonth(store.months[0]);
    expect(month).toHaveLength(1);
    expect(month[0].total).toBe(4.83);
  });
});

/**
 * `pendingSync` says "still in this device's outbox". A restored backup has an
 * empty outbox by definition, so a receipt that came back wearing the flag
 * would be badged as waiting forever, refuse to be voided or refunded, and be
 * dropped from its month file by the next write - which excludes queued sales.
 */
describe('backups and the offline outbox', () => {
  let mock;
  let storage;
  let store;

  const lines = [{ productId: null, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 10, taxName: 'Tax', discount: null }];
  const key = () => monthKeyOf(todayISO());
  const onDisk = () => JSON.parse(mock.files.get(`pos-data/sales-${key()}.json`) || '[]');

  beforeEach(async () => {
    mock = installMockPuter();
    storage = installMockStorage();
    store = new Store();
    await store.init();
  });
  afterEach(() => {
    storage.setOnLine(true);
    storage.uninstall();
    mock.uninstall();
  });

  it('exports a queued sale as plain history', async () => {
    mock.goOffline();
    const queued = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();

    const backup = await store.exportAll();
    const exported = backup.sales[key()];
    expect(exported.map((s) => s.id)).toEqual([queued.id]);
    expect(exported[0]).not.toHaveProperty('pendingSync');
    // The live copy keeps its flag - it really is still waiting.
    expect((await store.loadMonth(key()))[0].pendingSync).toBe(true);
  });

  it('restores it as settled history that later sales can’t erase', async () => {
    mock.goOffline();
    const queued = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();
    // A backup from before this fix, flag and all.
    const backup = await store.exportAll();
    backup.sales[key()][0].pendingSync = true;

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(backup);

    const restored = await fresh.loadMonth(key());
    expect(restored[0].pendingSync).toBeUndefined();
    expect(fresh.pendingSync).toBe(0);
    expect(onDisk()[0].pendingSync).toBeUndefined();

    const later = await fresh.completeSale({ lines, payment: { method: 'card' } });
    expect(onDisk().map((s) => s.id).sort()).toEqual([later.id, queued.id].sort());
  });
});
