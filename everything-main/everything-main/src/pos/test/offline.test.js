import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter, installMockStorage } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { Outbox, isTransportError } from '../src/lib/outbox.js';
import { canRefund } from '../src/lib/refunds.js';
import { todayISO, monthKeyOf } from '../src/lib/dates.js';

let mock;
let storage;
let store;

const lines = [{ productId: null, name: 'Latte', unitPrice: 4.6, qty: 1, taxRate: 10, taxName: 'Tax', discount: null }];
const monthFile = () => `pos-data/sales-${monthKeyOf(todayISO())}.json`;
const onDisk = () => JSON.parse(mock.files.get(monthFile()) || '[]');

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

describe('offline boot from the local snapshot', () => {
  it('opens the register with catalog, settings, and month indexes intact', async () => {
    await store.addProduct({ name: 'Latte', price: 4.6, slot: 1 });
    await store.updateSettings({ storeName: 'Corner Roast' });
    await store.completeSale({ lines, payment: { method: 'card' } });

    // A fresh online init writes the snapshot this boot will lean on.
    const warm = new Store();
    await warm.init();

    mock.goOffline();
    const cold = new Store();
    await expect(cold.init()).rejects.toThrow();
    expect(cold.initFromBootCache()).toBe(true);

    expect(cold.offlineBoot).toBe(true);
    expect(cold.settings.storeName).toBe('Corner Roast');
    expect(cold.products).toHaveLength(1);
    expect(cold.months).toContain(monthKeyOf(todayISO()));
    expect(cold.settings.nextReceipt).toBe(1002);
  });

  it('sells into the outbox, and the next online run drains it', async () => {
    const warm = new Store();
    await warm.init();

    mock.goOffline();
    storage.setOnLine(false);
    const cold = new Store();
    await expect(cold.init()).rejects.toThrow();
    expect(cold.initFromBootCache()).toBe(true);

    const sale = await cold.completeSale({ lines, payment: { method: 'cash' } });
    expect(sale.pendingSync).toBe(true);
    expect(cold.pendingSync).toBe(1);

    // Back online: a normal boot finds the same account-scoped queue.
    mock.goOnline();
    storage.setOnLine(true);
    const next = new Store();
    await next.init();
    expect(next.pendingSync).toBe(1);
    await next.syncOutbox();
    expect(next.pendingSync).toBe(0);
    expect(onDisk().some((s) => s.id === sale.id)).toBe(true);
  });

  /* The snapshot holds the whole store - the PIN record, the catalog, every
     customer's contact details - under a device-global key. It must not
     outlive the account that wrote it: sign-out clears it, and the next
     user's offline boot finds nothing rather than someone else's shop. */
  it('is cleared on sign-out so the next user can’t boot into it', async () => {
    await store.addCustomer({ name: 'Maya Lindqvist', phone: '555-0142' });
    const warm = new Store();
    await warm.init();
    expect(storage.data.has('pos:boot-cache:v1')).toBe(true);

    warm.clearBootCache();
    expect(storage.data.has('pos:boot-cache:v1')).toBe(false);

    mock.goOffline();
    const cold = new Store();
    expect(cold.initFromBootCache()).toBe(false);
  });

  /* Every local record this device keeps is account-scoped so a shared
     browser can't cross two users' data. The offline path set only some of
     the keys and left the rest on the device-global ':anon' one - so an
     offline boot read (and wrote) another account's snapshot-failure record
     and its posted-count markers. */
  it('scopes every local record to the account it booted as', async () => {
    const warm = new Store();
    await warm.init();
    storage.data.set('pos:snapshot-error:v1:test-user',
      JSON.stringify({ at: 1_700_000_000_000, why: 'quota exceeded' }));
    storage.data.set('pos:snapshot-error:v1:anon',
      JSON.stringify({ at: 1_600_000_000_000, why: 'somebody else’s shop' }));

    mock.goOffline();
    // An unreachable cloud can't say who is signed in either, so init falls
    // back to 'anon' before it fails - the snapshot is what names the account.
    puter.auth.getUser = async () => { throw new TypeError('Failed to fetch'); };
    const cold = new Store();
    await expect(cold.init()).rejects.toThrow();
    expect(cold.initFromBootCache()).toBe(true);
    expect(cold.snapshotError()).toEqual({ at: 1_700_000_000_000, why: 'quota exceeded' });
  });

  it('refuses to boot with nothing cached, or from damage', () => {
    storage.data.clear();
    const cold = new Store();
    expect(cold.initFromBootCache()).toBe(false);
    storage.data.set('pos:boot-cache:v1', 'not json');
    expect(cold.initFromBootCache()).toBe(false);
    expect(cold.offlineBoot).toBe(false);
  });
});

describe('isTransportError', () => {
  it('recognizes the ways a request fails to reach a host', () => {
    expect(isTransportError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportError(new Error('Load failed'))).toBe(true);
    expect(isTransportError(new Error('network error'))).toBe(true);
    expect(isTransportError(new Error('request timed out'))).toBe(true);
    expect(isTransportError({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransportError({ error: { code: 'service_unavailable' } })).toBe(true);
  });

  it('leaves real rejections to surface', () => {
    expect(isTransportError(new Error('permission_denied'))).toBe(false);
    expect(isTransportError({ code: 'subject_does_not_exist' })).toBe(false);
    expect(isTransportError(new Error('kv write failed'))).toBe(false);
    expect(isTransportError(null)).toBe(false);
  });

  it('trusts the browser when it says it is offline', () => {
    storage.setOnLine(false);
    expect(isTransportError(new Error('permission_denied'))).toBe(true);
    storage.setOnLine(true);
  });
});

describe('Outbox', () => {
  it('queues, reads back, and dequeues by id', () => {
    const box = new Outbox('user-1');
    box.add({ id: 'a', number: 1001, at: 1 }, '2026-08');
    box.add({ id: 'b', number: 1002, at: 2 }, '2026-08');
    box.add({ id: 'c', number: 1003, at: 3 }, '2026-09');

    expect(box.count).toBe(3);
    expect(box.months()).toEqual(['2026-08', '2026-09']);
    expect(box.forMonth('2026-08').map((r) => r.id)).toEqual(['a', 'b']);
    expect(box.maxNumber()).toBe(1003);

    box.remove(['a', 'c']);
    expect(box.count).toBe(1);
    expect(box.has('b')).toBe(true);
  });

  it('survives a reload and stays scoped to its account', () => {
    const mine = new Outbox('user-1');
    mine.add({ id: 'a', number: 1 }, '2026-08');
    expect(new Outbox('user-1').count).toBe(1);
    expect(new Outbox('user-2').count).toBe(0);
  });

  it('ignores a corrupted store rather than throwing on boot', () => {
    localStorage.setItem('pos:outbox:v1:broken', '{not json');
    expect(new Outbox('broken').count).toBe(0);
  });

  it('refuses to queue the same receipt twice', () => {
    const box = new Outbox('user-1');
    box.add({ id: 'a', number: 1 }, '2026-08');
    box.add({ id: 'a', number: 1 }, '2026-08');
    expect(box.count).toBe(1);
  });
});

describe('completing a sale with no network', () => {
  it('succeeds locally, queues the receipt, and keeps the number and stock', async () => {
    const p = await store.addProduct({ name: 'Latte', price: 4.6, slot: 1, trackStock: true, stock: 10 });
    const saleLines = [{ ...lines[0], productId: p.id }];

    mock.goOffline();
    const receipt = await store.completeSale({ lines: saleLines, payment: { method: 'cash' } });

    expect(receipt.number).toBe(1001);
    expect(receipt.total).toBe(5.06);
    expect(receipt.pendingSync).toBe(true);
    expect(store.pendingSync).toBe(1);
    expect(store.settings.nextReceipt).toBe(1002);
    expect(store.product(p.id).stock).toBe(9);

    // Visible in history right away, marked as not yet synced.
    const month = await store.loadMonth(monthKeyOf(receipt.date));
    expect(month.find((s) => s.id === receipt.id)?.pendingSync).toBe(true);
  });

  it('keeps numbering sequential across several offline sales', async () => {
    mock.goOffline();
    const a = await store.completeSale({ lines, payment: { method: 'cash' } });
    const b = await store.completeSale({ lines, payment: { method: 'card' } });
    const c = await store.completeSale({ lines, payment: { method: 'cash' } });
    expect([a.number, b.number, c.number]).toEqual([1001, 1002, 1003]);
    expect(store.pendingSync).toBe(3);
  });

  it('does not even try the network when the browser says it is offline', async () => {
    storage.setOnLine(false);
    const receipt = await store.completeSale({ lines, payment: { method: 'cash' } });
    expect(receipt.pendingSync).toBe(true);
    expect(mock.files.has(monthFile())).toBe(false);
    storage.setOnLine(true);
  });

  it('completes the first sale of a month whose file can’t even be read', async () => {
    // A previous month exists and is indexed, so the register wants to read a
    // file it can't reach - the "new month during an outage" case.
    const past = '2026-01';
    mock.kv.set('pos:months:v1', JSON.stringify([past]));
    mock.files.set(`pos-data/sales-${past}.json`, '[]');
    const fresh = new Store();
    await fresh.init();
    fresh.months = [...fresh.months, monthKeyOf(todayISO())];   // indexed, unwritten

    mock.goOffline();
    const receipt = await fresh.completeSale({ lines, payment: { method: 'cash' } });
    expect(receipt.pendingSync).toBe(true);
    expect(fresh.pendingSync).toBe(1);

    mock.goOnline();
    expect((await fresh.syncOutbox()).synced).toBe(1);
    expect(onDisk().map((s) => s.id)).toEqual([receipt.id]);
  });

  it('still rolls back a genuine rejection', async () => {
    mock.failNextFsWrite();   // 'fs write failed' - not transport-shaped
    await expect(store.completeSale({ lines, payment: { method: 'card' } })).rejects.toThrow();
    expect(store.pendingSync).toBe(0);
    expect(store.settings.nextReceipt).toBe(1001);
    expect(await store.loadMonth(monthKeyOf(todayISO()))).toHaveLength(0);
  });

  it('survives a reload with the sale intact and numbering continuing', async () => {
    mock.goOffline();
    const receipt = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.pendingSync).toBe(1);
    // The settings write never landed, so the counter is rebuilt from the queue.
    expect(reloaded.settings.nextReceipt).toBe(receipt.number + 1);
    const month = await reloaded.loadMonth(monthKeyOf(receipt.date));
    expect(month.map((s) => s.id)).toEqual([receipt.id]);
    expect(month[0].pendingSync).toBe(true);
  });
});

describe('a queued sale in a month with no file yet', () => {
  it('counts in reports, the drawer, and an export, not just the receipts list', async () => {
    const today = todayISO();
    expect(store.months).toHaveLength(0);   // nothing indexed: a brand-new month

    mock.goOffline();
    const receipt = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();

    // What the receipts list shows and what a report totals must agree.
    const listed = await store.loadMonth(monthKeyOf(today));
    const ranged = await store.salesInRange(today, today);
    expect(listed.map((s) => s.id)).toEqual([receipt.id]);
    expect(ranged.map((s) => s.id)).toEqual([receipt.id]);

    // The cash is in the drawer, so the day's expected total has to include it.
    await store.openDrawer({ date: today, float: 50 });
    const summary = await store.drawerSummary(today);
    expect(summary.cashSales).toBe(receipt.total);
    expect(summary.expected).toBe(50 + receipt.total);

    const backup = await store.exportAll();
    expect(backup.sales[monthKeyOf(today)].map((s) => s.id)).toEqual([receipt.id]);
  });
});

/**
 * A queued sale is history, but it is history that only this device holds.
 * Voiding it would be written to a month file that deliberately excludes queued
 * sales, and refunding it would file the refund in the cloud while the note of
 * what came back stayed local - so both wait for the sync.
 */
describe('void and refund against a sale that has not synced', () => {
  const queuedSale = async () => {
    mock.goOffline();
    const receipt = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();
    return receipt;
  };

  it('refuses the void, and says why', async () => {
    const receipt = await queuedSale();
    await expect(store.voidSale(receipt.id, receipt.date)).rejects.toThrow(/hasn’t reached your cloud/);

    // Nothing was applied optimistically either.
    const month = await store.loadMonth(monthKeyOf(receipt.date));
    expect(month.find((s) => s.id === receipt.id).voidedAt).toBeUndefined();
    await store.syncOutbox();
    expect(onDisk()[0].voidedAt).toBeUndefined();
  });

  it('refuses the refund, so the same units can never come back twice', async () => {
    const receipt = await queuedSale();
    await expect(store.refundSale({
      receiptId: receipt.id, date: receipt.date, picks: [{ index: 0, qty: 1 }],
    })).rejects.toThrow(/hasn’t reached your cloud/);

    expect(store.settings.nextReceipt).toBe(receipt.number + 1);   // no number burnt
    const month = await store.loadMonth(monthKeyOf(receipt.date));
    expect(month.filter((s) => s.type === 'refund')).toHaveLength(0);
  });

  it('offers neither action in the UI while the sale is queued', async () => {
    const receipt = await queuedSale();
    const month = await store.loadMonth(monthKeyOf(receipt.date));
    expect(canRefund(month.find((s) => s.id === receipt.id))).toBe(false);
  });
});

describe('receipt numbers under failing settings writes', () => {
  /* A settings edit whose write dies rolls the settings object back - but a
     sale completing during the round trip has already taken a number and
     advanced the counter. Rolling that back reissues the sale's number.
     Offline is where nothing else can catch it: the month file can't be
     read to floor against, only the outbox knows what was issued. */
  it('a failed settings write can’t hand a queued sale’s number out again', async () => {
    const realSet = puter.kv.set;
    puter.kv.set = async (key, value) => {
      if (key === 'pos:settings:v1') {
        puter.kv.set = realSet;   // only this one write hangs, then dies
        await new Promise((r) => setTimeout(r, 20));
        throw new TypeError('Failed to fetch');
      }
      return realSet(key, value);
    };
    const editing = store.updateSettings({ receiptFooter: 'Thanks!' }).catch(() => {});
    storage.setOnLine(false);
    mock.goOffline();
    const a = await store.completeSale({ lines, payment: { method: 'cash' } });
    await editing;   // the rollback lands after the sale advanced the counter
    const b = await store.completeSale({ lines, payment: { method: 'cash' } });
    expect(a.number).toBe(1001);
    expect(b.number).toBe(1002);
    expect(store.settings.nextReceipt).toBe(1003);
  });
});

describe('syncing the outbox', () => {
  it('writes queued sales to their month file exactly once, in order', async () => {
    mock.goOffline();
    const a = await store.completeSale({ lines, payment: { method: 'cash' } });
    const b = await store.completeSale({ lines, payment: { method: 'card' } });
    mock.goOnline();

    const result = await store.syncOutbox();
    expect(result.synced).toBe(2);
    expect(store.pendingSync).toBe(0);

    const written = onDisk();
    expect(written.map((s) => s.number)).toEqual([b.number, a.number]);   // newest first
    expect(written.every((s) => s.pendingSync === undefined)).toBe(true);

    // A second sync is a no-op, not a duplicate.
    await store.syncOutbox();
    expect(onDisk()).toHaveLength(2);

    // And the pending flag is gone from what the UI shows.
    const month = await store.loadMonth(monthKeyOf(a.date));
    expect(month.some((s) => s.pendingSync)).toBe(false);
  });

  it('appends onto what is already on disk instead of overwriting it', async () => {
    const online = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(onDisk()).toHaveLength(1);

    mock.goOffline();
    const offline = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();
    await store.syncOutbox();

    const ids = onDisk().map((s) => s.id);
    expect(ids).toContain(online.id);
    expect(ids).toContain(offline.id);
    expect(ids).toHaveLength(2);
  });

  it('does not write a queued sale through an ordinary month write', async () => {
    mock.goOffline();
    const queued = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();

    // A later online sale persists the month; the queued one must stay out of
    // that file, or the flush would append a second copy.
    const later = await store.completeSale({ lines, payment: { method: 'card' } });
    expect(onDisk().map((s) => s.id)).toEqual([later.id]);

    await store.syncOutbox();
    const ids = onDisk().map((s) => s.id);
    expect(ids.sort()).toEqual([later.id, queued.id].sort());
  });

  it('leaves everything queued when the network is still down', async () => {
    mock.goOffline();
    await store.completeSale({ lines, payment: { method: 'cash' } });
    const result = await store.syncOutbox();
    expect(result.synced).toBe(0);
    expect(store.pendingSync).toBe(1);
    expect(store.syncFailed).toBe(false);   // offline is not a failure to report

    mock.goOnline();
    expect((await store.syncOutbox()).synced).toBe(1);
  });

  it('flushes sales queued across two months', async () => {
    mock.goOffline();
    const receipt = await store.completeSale({ lines, payment: { method: 'cash' } });
    // A second queued sale, filed under a different month.
    const otherMonth = receipt.date.startsWith('2026-01') ? '2026-02-14' : '2026-01-14';
    store.outbox.add({ ...receipt, id: 'other', number: 1002, date: otherMonth, at: 1 }, monthKeyOf(otherMonth));
    mock.goOnline();

    const result = await store.syncOutbox();
    expect(result.synced).toBe(2);
    expect(store.months).toContain(monthKeyOf(otherMonth));
    const other = JSON.parse(mock.files.get(`pos-data/sales-${monthKeyOf(otherMonth)}.json`));
    expect(other.map((s) => s.id)).toEqual(['other']);
  });

  /* The stock decrement of a queued sale lived only in memory: a reload
     re-read the cloud's pre-sale levels, and the sync that followed wrote
     those stale levels back - inventory permanently high, no error shown. */
  it('a queued sale’s stock decrement survives a reload', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    mock.goOffline();
    await store.completeSale({
      lines: [{ productId: p.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'cash' },
    });
    expect(store.product(p.id).stock).toBe(3);

    // Overnight: network back, tablet rebooted, queue not yet drained.
    mock.goOnline();
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.product(p.id).stock).toBe(3);   // not the cloud's stale 5

    await reloaded.syncOutbox();
    expect(reloaded.pendingSync).toBe(0);
    expect(JSON.parse(mock.kv.get('pos:products:v1'))[0].stock).toBe(3);

    // Settled: another reload must not apply the moves a second time.
    const again = new Store();
    await again.init();
    expect(again.product(p.id).stock).toBe(3);
  });

  /* Any successful products write carries the in-memory levels, queued
     moves included - after one, a reload must not replay them on top. */
  it('does not double-apply moves once any products write has landed', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    mock.goOffline();
    await store.completeSale({
      lines: [{ productId: p.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'cash' },
    });
    mock.goOnline();

    // An ordinary catalog edit while the sale is still queued: its write
    // carries stock 3 to the cloud and settles the debt.
    await store.updateProduct(p.id, { name: 'Blue mug', price: 16, slot: 1, trackStock: true, stock: 3 });
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.product(p.id).stock).toBe(3);   // not 1
  });

  it('a refund restock whose products write failed survives a reload', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    const sale = await store.completeSale({
      lines: [{ productId: p.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'cash' },
    });
    expect(store.product(p.id).stock).toBe(3);

    const realSet = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k === 'pos:products:v1') throw new TypeError('Failed to fetch');
      return realSet(k, v);
    };
    await store.refundSale({ receiptId: sale.id, date: sale.date, picks: [{ index: 0, qty: 2 }] });
    await new Promise((r) => setTimeout(r, 0));   // let the write's rejection land
    puter.kv.set = realSet;
    expect(store.product(p.id).stock).toBe(5);

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.product(p.id).stock).toBe(5);   // not the cloud's stale 3
  });

  it('converges stock and the receipt counter after a sync', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 4 });
    mock.goOffline();
    await store.completeSale({
      lines: [{ productId: p.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'cash' },
    });
    mock.goOnline();
    await store.syncOutbox();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.product(p.id).stock).toBe(2);
    expect(reloaded.settings.nextReceipt).toBe(1002);
    expect(reloaded.pendingSync).toBe(0);
  });

  /* The killer sequence: the drain's merge write is in flight when the next
     customer pays. The sale's own month write is queued behind the merge -
     if it snapshots the month list before the merge lands (while the queued
     sale still wears its flag), it overwrites the file without it, and the
     outbox has already let go: the receipt is gone from both places. */
  it('a sale completing while the outbox drains keeps the queued sale on file', async () => {
    const first = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOffline();
    const queued = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();

    // Slow the cloud so the merge is still writing when the sale lands.
    const write = puter.fs.write;
    puter.fs.write = async (...args) => {
      await new Promise((r) => setTimeout(r, 20));
      return write(...args);
    };
    const draining = store.syncOutbox();
    await new Promise((r) => setTimeout(r, 5));
    const third = await store.completeSale({ lines, payment: { method: 'card' } });
    await draining;
    puter.fs.write = write;

    expect(onDisk().map((s) => s.id).sort()).toEqual([first.id, queued.id, third.id].sort());
    expect(store.pendingSync).toBe(0);
    // And what a reload reads agrees.
    const reloaded = new Store();
    await reloaded.init();
    expect((await reloaded.loadMonth(monthKeyOf(first.date))).map((s) => s.id).sort())
      .toEqual([first.id, queued.id, third.id].sort());
  });

  /* The post-sale products write is fire-and-forget - a sale must not fail
     because its bookkeeping did. But a swallowed failure left the shelf
     count diverged forever: the outbox was empty, so no sync pass would
     ever rewrite it. */
  it('re-converges stock after a failed post-sale products write', async () => {
    const p = await store.addProduct({ name: 'Mug', price: 16, slot: 1, trackStock: true, stock: 5 });
    const realSet = puter.kv.set;
    puter.kv.set = async (k, v) => {
      if (k === 'pos:products:v1') {
        puter.kv.set = realSet;
        throw new Error('quota exceeded');   // a real rejection, not the network
      }
      return realSet(k, v);
    };
    await store.completeSale({
      lines: [{ productId: p.id, name: 'Mug', unitPrice: 16, qty: 2, taxRate: 0, taxName: '', discount: null }],
      payment: { method: 'cash' },
    });
    await new Promise((r) => setTimeout(r, 0));   // let the write's rejection land
    expect(store.needsConverge).toBe(true);

    await store.syncOutbox();                     // outbox is empty: converge-only pass
    expect(store.needsConverge).toBe(false);
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.product(p.id).stock).toBe(3);
  });

  /* Valid JSON in the wrong shape is damage; the drain parks it like a parse
     failure - read as empty it would be overwritten in place. */
  it('parks a wrong-shaped month file instead of overwriting it', async () => {
    mock.goOffline();
    const queued = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();
    mock.files.set(monthFile(), '"oops"');

    expect((await store.syncOutbox()).synced).toBe(1);
    const parked = [...mock.files.keys()].find((k) => k.startsWith(`${monthFile()}.corrupt-`));
    expect(mock.files.get(parked)).toBe('"oops"');
    expect(onDisk().map((s) => s.id)).toEqual([queued.id]);
  });

  it('is single-flight under concurrent calls', async () => {
    mock.goOffline();
    await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();
    const [a, b] = await Promise.all([store.syncOutbox(), store.syncOutbox()]);
    expect(a).toBe(b);
    expect(onDisk()).toHaveLength(1);
  });

  it('leaves a queued sale voidable and refundable once it has landed', async () => {
    mock.goOffline();
    const receipt = await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();
    await store.syncOutbox();

    const month = await store.loadMonth(monthKeyOf(receipt.date));
    const landed = month.find((s) => s.id === receipt.id);
    expect(landed.pendingSync).toBeUndefined();
    expect(canRefund(landed)).toBe(true);
    await expect(store.voidSale(receipt.id, receipt.date)).resolves.toBeTruthy();
  });

  it('a wholesale import discards anything still queued', async () => {
    mock.goOffline();
    await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();
    expect(store.pendingSync).toBe(1);

    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings }, products: [], categories: [], taxes: [], discounts: [], sales: {},
    });
    expect(store.pendingSync).toBe(0);
  });
});

describe('the open draft once its sale completes', () => {
  it('does not resurrect a cart sold offline whose clearing write was lost', async () => {
    // Cashier builds the cart online; autosave lands in KV.
    store.queueDraft({ lines, orderDiscount: null });
    await store.flushDraft();

    // The network drops; the sale completes into the outbox, and the
    // register's draft-clear write can't reach the cloud.
    mock.goOffline();
    await store.completeSale({ lines, payment: { method: 'cash' } });
    store.queueDraft(null);
    await store.flushDraft();

    // Network returns, the queue drains, then the tablet reboots. The KV
    // draft still holds the sold cart - restoring it would invite ringing
    // the same sale up twice.
    mock.goOnline();
    await store.syncOutbox();
    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.draft).toBeNull();
    expect(reloaded.consumeRestoredDraft()).toBe(false);
  });

  it('is spent by an online sale too, without waiting for the register', async () => {
    store.queueDraft({ lines, orderDiscount: null });
    await store.flushDraft();
    await store.completeSale({ lines, payment: { method: 'card' } });
    expect(store.draft).toBeNull();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.draft).toBeNull();
  });

  it('still restores a draft started after the sale', async () => {
    mock.goOffline();
    await store.completeSale({ lines, payment: { method: 'cash' } });
    mock.goOnline();

    // The next customer's cart begins after the sale; it must survive.
    await new Promise((r) => setTimeout(r, 5));
    store.queueDraft({ lines, orderDiscount: null });
    await store.flushDraft();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.draft?.lines).toHaveLength(1);
    expect(reloaded.consumeRestoredDraft()).toBe(true);
  });
});
