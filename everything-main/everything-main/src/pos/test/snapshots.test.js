import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter, installMockStorage } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import {
  snapshotName, SNAPSHOT_FILE, cleanSnapshots, retentionPlan, formatBytes,
  snapshotHolds, KEEP_RECENT, KEEP_WEEKS,
} from '../src/lib/snapshots.js';

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

/** Something worth losing, so the automatic paths have a reason to run. */
async function shopWithData() {
  const p = await store.addProduct({ name: 'Latte', price: 4.6, sku: 'L1' });
  await store.addCustomer({ name: 'Maya' });
  await store.completeSale({
    lines: [{ productId: p.id, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 0, taxName: '', discount: null }],
    payment: { method: 'card' },
  });
  return p;
}

describe('snapshotName', () => {
  it('is built from a stamp and a known reason, never from typed text', () => {
    const at = new Date(2026, 7, 20, 14, 32, 5, 817).getTime();
    expect(snapshotName(at, 'daily')).toBe('snapshot-2026-08-20-143205817-daily.json');
    // Anything unrecognized becomes 'manual' rather than a path segment.
    expect(snapshotName(at, '../../escape')).toBe('snapshot-2026-08-20-143205817-manual.json');
    expect(SNAPSHOT_FILE.test(snapshotName(at, 'close'))).toBe(true);
  });

  it('names two snapshots in the same second differently', () => {
    const at = new Date(2026, 7, 20, 14, 32, 5, 100).getTime();
    // Same second, different milliseconds: the second must not overwrite the
    // first on disk while both stay in the index.
    expect(snapshotName(at, 'manual')).not.toBe(snapshotName(at + 40, 'manual'));
  });
});

describe('cleanSnapshots', () => {
  it('drops anything that isn’t a file this app wrote', () => {
    const good = { file: snapshotName(Date.now(), 'daily'), at: 5, reason: 'daily' };
    expect(cleanSnapshots([good, { file: '../secrets.json' }, null, {}])).toHaveLength(1);
  });

  it('keeps one row per file, newest', () => {
    const file = snapshotName(Date.now(), 'manual');
    const rows = cleanSnapshots([
      { file, at: 10, products: 1 },
      { file, at: 20, products: 2 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ at: 20, products: 2 });
  });

  it('sorts newest first and normalizes the counts', () => {
    const a = { file: snapshotName(1, 'daily'), at: 1, products: '3', receipts: -2 };
    const b = { file: snapshotName(2, 'close'), at: 2 };
    const [first, second] = cleanSnapshots([a, b]);
    expect(first.at).toBe(2);
    expect(second.products).toBe(3);
    expect(second.receipts).toBe(0);
  });
});

describe('retentionPlan', () => {
  const day = 24 * 60 * 60 * 1000;
  const at = (daysAgo) => Date.now() - daysAgo * day;
  const entry = (daysAgo) => ({ file: snapshotName(at(daysAgo), 'daily'), at: at(daysAgo), reason: 'daily' });

  it('keeps the newest handful whatever they are', () => {
    const list = Array.from({ length: KEEP_RECENT }, (_, i) => entry(i * 0.1));
    expect(retentionPlan(list).prune).toHaveLength(0);
  });

  it('thins older ones to one a week, then prunes the rest', () => {
    // Twelve days of two-a-day, well past the recent window.
    const list = [];
    for (let d = 0; d < 12; d++) {
      list.push(entry(d + 0.1));
      list.push(entry(d + 0.6));
    }
    const { keep, prune } = retentionPlan(list);
    // How many weeks 12 days spans depends on which weekday today is, so the
    // invariants are what's asserted rather than one arithmetic answer.
    expect(keep.length).toBeGreaterThanOrEqual(KEEP_RECENT);
    expect(keep.length).toBeLessThanOrEqual(KEEP_RECENT + KEEP_WEEKS);
    expect(prune.length).toBe(list.length - keep.length);
    // The newest are kept whatever they are.
    const newest = cleanSnapshots(list).slice(0, KEEP_RECENT).map((e) => e.file);
    expect(keep.slice(0, KEEP_RECENT).map((e) => e.file)).toEqual(newest);
    // Beyond them, at most one a week survives - in the same weeks the plan
    // keeps, which are local and start on Monday. Dividing the timestamp by
    // seven days instead measures UTC weeks that turn over on a Thursday, so
    // a Sunday and the Monday after it - two weeks to the plan, and rightly
    // both kept - counted as one and failed this on most weekdays.
    const week = (at) => {
      const d = new Date(at);
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    const older = keep.slice(KEEP_RECENT).map((e) => week(e.at));
    expect(new Set(older).size).toBe(older.length);
    // Nothing is both kept and pruned, and every entry is accounted for.
    const files = new Set([...keep, ...prune].map((e) => e.file));
    expect(files.size).toBe(new Set(list.map((e) => e.file)).size);
  });
});

describe('taking a snapshot', () => {
  it('writes the exporter’s own file and indexes what it holds', async () => {
    await shopWithData();
    const entry = await store.takeSnapshot('manual');

    expect(SNAPSHOT_FILE.test(entry.file)).toBe(true);
    expect(entry).toMatchObject({ reason: 'manual', products: 1, receipts: 1, customers: 1 });
    expect(entry.bytes).toBeGreaterThan(0);
    expect(store.snapshots.map((s) => s.file)).toEqual([entry.file]);

    // The file is a real export, readable back through the same path a
    // hand-taken backup takes.
    const data = await store.readSnapshot(entry.file);
    expect(data.app).toBe('point-of-sale');
    expect(data.products).toHaveLength(1);

    // And it survives a reload, because the index does.
    const fresh = new Store();
    await fresh.init();
    expect(fresh.snapshots.map((s) => s.file)).toEqual([entry.file]);
  });

  it('leaves the index alone when the index write fails', async () => {
    await shopWithData();
    mock.failNextKvSet();
    await expect(store.takeSnapshot('manual')).rejects.toThrow();
    expect(store.snapshots).toHaveLength(0);
  });

  it('restores through the ordinary import path', async () => {
    const p = await shopWithData();
    const entry = await store.takeSnapshot('manual');
    await store.deleteProduct(p.id);
    expect(store.products).toHaveLength(0);

    const data = await store.readSnapshot(entry.file);
    await store.importAll(data);
    expect(store.products.map((x) => x.name)).toEqual(['Latte']);
    // The restore points themselves are not part of the dataset, so a
    // restore doesn't take them with it.
    expect(store.snapshots.some((s) => s.file === entry.file)).toBe(true);
  });

  it('deletes one from the index and the disk', async () => {
    await shopWithData();
    const entry = await store.takeSnapshot('manual');
    const path = `pos-data/snapshots/${entry.file}`;
    expect(mock.files.has(path)).toBe(true);
    await store.deleteSnapshot(entry.file);
    expect(store.snapshots).toHaveLength(0);
    expect(mock.files.has(path)).toBe(false);
  });
});

describe('the automatic ones', () => {
  it('takes nothing on an account with nothing to lose', async () => {
    expect(await store.autoSnapshot('restore')).toBeNull();
    expect(store.snapshots).toHaveLength(0);
  });

  it('takes one before a restore, a catalog import, and a posted count', async () => {
    const p = await shopWithData();
    await store.importAll({
      app: 'point-of-sale', version: 1, settings: { ...store.settings }, products: [], sales: {},
    });
    expect(store.snapshots.map((s) => s.reason)).toEqual(['restore']);

    // The minute-long floor means the next destructive act reuses this one
    // as its restore point rather than writing a near-identical copy.
    await store.addProduct({ name: 'Bun', price: 2 });
    await store.importProducts({ creates: [{ patch: { name: 'Roll', price: 3 } }] });
    expect(store.snapshots).toHaveLength(1);

    // Past the floor, a fresh one is taken.
    store.snapshots = store.snapshots.map((s) => ({ ...s, at: s.at - 10 * 60 * 1000 }));
    await store.importProducts({ creates: [{ patch: { name: 'Cake', price: 4 } }] });
    expect(store.snapshots.map((s) => s.reason)).toEqual(['import', 'restore']);
    expect(p).toBeTruthy();
  });

  it('never lets a failed snapshot stop the destructive action', async () => {
    await shopWithData();
    mock.failNextFsWrite();
    // The restore goes through; the snapshot in front of it did not.
    await store.importAll({
      app: 'point-of-sale', version: 1, settings: { ...store.settings }, products: [], sales: {},
    });
    expect(store.products).toHaveLength(0);
    expect(store.snapshots).toHaveLength(0);
    // And the failure is remembered, so Settings can warn about it.
    expect(store.snapshotError()?.why).toMatch(/fs write failed/);
  });

  it('skips the daily one when a recent snapshot already serves', async () => {
    await shopWithData();
    const first = await store.takeSnapshot('close');
    expect(await store.dailySnapshot()).toBeNull();

    store.snapshots = store.snapshots.map((s) => ({ ...s, at: s.at - 30 * 60 * 60 * 1000 }));
    const daily = await store.dailySnapshot();
    expect(daily.reason).toBe('daily');
    expect(store.snapshots).toHaveLength(2);
    expect(first.file).not.toBe(daily.file);
  });

  it('takes none at all when the shop has turned them off', async () => {
    await shopWithData();
    await store.updateSettings({ autoSnapshot: false });
    expect(await store.dailySnapshot()).toBeNull();
    expect(await store.autoSnapshot('restore')).toBeNull();
    expect(store.snapshots).toHaveLength(0);
  });

  it('takes one at day close, without holding the close up', async () => {
    await shopWithData();
    await store.openDrawer({ float: 50 });
    await store.closeDrawer({ counted: 50 });
    // Fire-and-forget: let the microtask it was started in settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.snapshots.map((s) => s.reason)).toEqual(['close']);
  });
});

describe('what the list says', () => {
  it('reads a size and what a point holds', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3 MB');
    expect(snapshotHolds({ products: 312, receipts: 1847 }))
      .toBe('312 products · 1,847 sales');
    expect(snapshotHolds({ products: 1, receipts: 1 })).toBe('1 product · 1 sale');
  });
});
