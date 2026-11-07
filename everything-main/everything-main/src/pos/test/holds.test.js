import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installMockPuter } from './helpers/mock-puter.js';
import { Store } from '../src/lib/store.js';
import { computeCart } from '../src/lib/totals.js';
import { formatAgo } from '../src/lib/dates.js';

let mock;
let store;

const lines = () => ([
  { productId: 'p1', name: 'Latte', unitPrice: 4.6, qty: 2, taxRate: 10, taxName: 'Tax', discount: null },
  { productId: 'p2', name: 'Muffin', unitPrice: 3.9, qty: 1, taxRate: 10, taxName: 'Tax', discount: null },
]);

beforeEach(async () => {
  mock = installMockPuter();
  store = new Store();
  await store.init();
});

afterEach(() => {
  vi.useRealTimers();
  mock.uninstall();
});

describe('holds', () => {
  it('parks a cart with its lines and discount, newest first', async () => {
    const a = await store.addHold({ label: '14:32 · $13.31', lines: lines(), orderDiscount: null });
    const b = await store.addHold({ label: '14:40 · $4.60', name: 'blue jacket', lines: [lines()[0]], orderDiscount: { type: 'percent', value: 10 } });

    expect(store.holds.map((h) => h.id)).toEqual([b.id, a.id]);
    expect(store.hold(a.id).lines).toHaveLength(2);
    expect(store.hold(b.id).name).toBe('blue jacket');
    expect(store.hold(b.id).orderDiscount).toEqual({ type: 'percent', value: 10 });
    expect(store.hold(b.id).createdAt).toBeGreaterThan(0);
  });

  it('survives a reload with identical lines and totals', async () => {
    const held = await store.addHold({
      label: 'x', lines: lines(), orderDiscount: { type: 'fixed', value: 2 },
    });
    const before = computeCart(held.lines, { orderDiscount: held.orderDiscount });

    const reloaded = new Store();
    await reloaded.init();
    const same = reloaded.hold(held.id);
    expect(same).not.toBeNull();
    expect(same.lines).toEqual(held.lines);
    const after = computeCart(same.lines, { orderDiscount: same.orderDiscount });
    expect(after.total).toBe(before.total);
    expect(after.itemCount).toBe(before.itemCount);
    expect(after.taxTotal).toBe(before.taxTotal);
  });

  it('snapshots the lines, so editing the cart afterwards cannot reach in', async () => {
    const cart = lines();
    const held = await store.addHold({ label: 'x', lines: cart });
    cart[0].qty = 99;
    cart.push({ productId: 'p3', name: 'Sneaky', unitPrice: 1, qty: 1, taxRate: 0, taxName: '', discount: null });
    expect(store.hold(held.id).lines).toHaveLength(2);
    expect(store.hold(held.id).lines[0].qty).toBe(2);
  });

  it('refuses an empty hold and rolls back a failed write', async () => {
    await expect(store.addHold({ label: 'x', lines: [] })).rejects.toThrow(/Nothing to hold/);
    mock.failNextKvSet();
    await expect(store.addHold({ label: 'x', lines: lines() })).rejects.toThrow();
    expect(store.holds).toEqual([]);
  });

  it('caps the working set instead of growing without bound', async () => {
    for (let i = 0; i < 40; i++) await store.addHold({ label: `h${i}`, lines: lines() });
    await expect(store.addHold({ label: 'over', lines: lines() })).rejects.toThrow(/Too many/);
    expect(store.holds).toHaveLength(40);
  });

  it('removes a hold, and rolls back if the write fails', async () => {
    const held = await store.addHold({ label: 'x', lines: lines() });
    mock.failNextKvSet();
    await expect(store.removeHold(held.id)).rejects.toThrow();
    expect(store.hold(held.id)).not.toBeNull();

    expect(await store.removeHold(held.id)).toMatchObject({ id: held.id });
    expect(store.holds).toEqual([]);
    expect(await store.removeHold(held.id)).toBeNull();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.holds).toEqual([]);
  });

  it('drops malformed holds on load rather than rendering ghosts', async () => {
    mock.kv.set('pos:holds:v1', JSON.stringify([
      { id: 'ok', lines: lines(), createdAt: 1 },
      { id: 'no-lines', createdAt: 2 },
      { lines: lines() },
      { id: 'empty', lines: [], createdAt: 3 },
      null,
    ]));
    const fresh = new Store();
    await fresh.init();
    expect(fresh.holds.map((h) => h.id)).toEqual(['ok']);
  });
});

describe('draft cart', () => {
  it('writes the first change straight through and coalesces the rest', async () => {
    vi.useFakeTimers();
    store.queueDraft({ lines: lines(), orderDiscount: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(mock.kv.get('pos:draft:v1')).lines).toHaveLength(2);

    // Two rapid follow-ups collapse into one trailing write.
    store.queueDraft({ lines: [lines()[0]], orderDiscount: null });
    store.queueDraft({ lines: lines(), orderDiscount: { type: 'percent', value: 5 } });
    expect(JSON.parse(mock.kv.get('pos:draft:v1')).lines).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    const written = JSON.parse(mock.kv.get('pos:draft:v1'));
    expect(written.orderDiscount).toEqual({ type: 'percent', value: 5 });
  });

  it('is restored on init and announced exactly once', async () => {
    store.queueDraft({ lines: lines(), orderDiscount: { type: 'fixed', value: 1 } });
    await store.flushDraft();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.draft.lines).toHaveLength(2);
    expect(reloaded.draft.orderDiscount).toEqual({ type: 'fixed', value: 1 });
    expect(reloaded.consumeRestoredDraft()).toBe(true);
    expect(reloaded.consumeRestoredDraft()).toBe(false);
  });

  it('clears on an emptied cart, and an empty draft is not "restored"', async () => {
    store.queueDraft({ lines: lines() });
    await store.flushDraft();
    store.queueDraft(null);
    await store.flushDraft();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.draft).toBeNull();
    expect(reloaded.consumeRestoredDraft()).toBe(false);
  });

  it('never lets a failed autosave surface as a rejection', async () => {
    mock.failNextKvSet();
    await expect(store.flushDraft()).resolves.not.toThrow();
  });

  it('a wholesale import clears holds and the open cart', async () => {
    await store.addHold({ label: 'x', lines: lines() });
    store.queueDraft({ lines: lines() });
    await store.flushDraft();

    await store.importAll({
      app: 'point-of-sale', version: 1,
      settings: { ...store.settings },
      products: [], categories: [], taxes: [], discounts: [], sales: {},
    });
    expect(store.holds).toEqual([]);
    expect(store.draft).toBeNull();

    const reloaded = new Store();
    await reloaded.init();
    expect(reloaded.holds).toEqual([]);
    expect(reloaded.draft).toBeNull();
  });
});

describe('formatAgo', () => {
  it('reads as a glanceable age', () => {
    const now = Date.UTC(2026, 7, 4, 12, 0, 0);
    expect(formatAgo(now - 5_000, now)).toBe('just now');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatAgo(now - 90 * 60_000, now)).toBe('1 h ago');
    expect(formatAgo(now - 26 * 3600_000, now)).toBe('yesterday');
    expect(formatAgo(now - 3 * 24 * 3600_000, now)).toBe('3 days ago');
    expect(formatAgo(now + 5_000, now)).toBe('just now');
  });
});
