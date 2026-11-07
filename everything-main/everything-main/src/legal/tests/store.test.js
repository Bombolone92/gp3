import { describe, it, expect, vi } from 'vitest';
import { createStore, COLLECTIONS } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { billTotals, trustBalance, billBalance } from '../src/core/finance.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (store) => {
  await store.flush();
  await tick();
};

describe('store', () => {
  it('applies writes locally first, then flushes them to the backend', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    const m = store.put('matters', { description: 'Estate plan' });
    expect(store.get('matters', m.id).description).toBe('Estate plan');
    expect(store.pendingCount()).toBe(1);
    await settle(store);
    expect(backend.peek('matters')).toHaveLength(1);
    expect(store.pendingCount()).toBe(0);
  });

  it('notifies subscribers once per microtask with the changed collections', async () => {
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 1e6 });
    await store.init();
    const fn = vi.fn();
    store.subscribe(fn);
    store.put('tasks', { name: 'a' });
    store.put('tasks', { name: 'b' });
    store.put('events', { title: 'c' });
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0][0]].sort()).toEqual(['events', 'tasks']);
  });

  it('caches list arrays until the collection changes', async () => {
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 1e6 });
    await store.init();
    store.put('tasks', { name: 'a' });
    const a = store.all('tasks');
    expect(store.all('tasks')).toBe(a);
    store.put('tasks', { name: 'b' });
    expect(store.all('tasks')).not.toBe(a);
  });

  it('restores a deleted record (undo)', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    const t = store.put('tasks', { name: 'Keep me' });
    await settle(store);
    store.remove('tasks', t.id);
    store.restore('tasks', t);
    await settle(store);
    expect(backend.peek('tasks').map((x) => x.name)).toEqual(['Keep me']);
  });

  it('keeps changes made while offline and sends them when back', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    backend.setFailing(true);
    store.put('notes', { subject: 'Offline note' });
    await store.flush();
    expect(store.state.online).toBe(false);
    expect(store.pendingCount()).toBe(1);
    backend.setFailing(false);
    await store.flush();
    expect(store.state.online).toBe(true);
    expect(backend.peek('notes')).toHaveLength(1);
  });

  it('picks up another device’s writes on sync, and only reloads what moved', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 0 });
    await a.init();
    await b.init();
    a.put('contacts', { type: 'person', firstName: 'Amara' });
    await settle(a);
    const spy = vi.spyOn(backend, 'loadCollection');
    await b.sync();
    expect(b.all('contacts')).toHaveLength(1);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['contacts']);
  });

  it('local unsent writes win over what a sync reads', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 1e6 });
    await a.init();
    await b.init();
    const t = a.put('tasks', { name: 'v1' });
    await settle(a);
    await b.sync();
    b.patch('tasks', t.id, { name: 'mine' });
    a.patch('tasks', t.id, { name: 'theirs' });
    await settle(a);
    await b.sync();
    expect(b.get('tasks', t.id).name).toBe('mine');
  });

  it('hands out increasing numbers that never go below what exists', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    store.put('matters', { number: 41 });
    expect(await store.nextNumber('matters')).toBe(42);
    expect(await store.nextNumber('matters')).toBe(43);
    expect(await store.nextNumber('bills')).toBe(1);
  });

  it('saves settings as a deep merge', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0 });
    await store.init();
    store.saveSettings({ billing: { increment: 15 } });
    expect(store.state.settings.billing.increment).toBe(15);
    expect(store.state.settings.billing.termsDays).toBe(30);
    await settle(store);
    expect((await backend.loadSettings()).billing.increment).toBe(15);
  });

  it('serves a cached snapshot instantly, including unsent writes', async () => {
    let saved = null;
    const cache = { load: async () => saved, save: async (s) => void (saved = structuredClone(s)) };
    const backend = createMemoryBackend();
    backend.setFailing(true);
    const store = createStore({ backend, cache, flushDelay: 0 });
    await store.init();
    store.put('tasks', { name: 'Draft' });
    await new Promise((r) => setTimeout(r, 700));
    expect(saved.pending.puts).toHaveLength(1);
    const again = createStore({ backend, cache, flushDelay: 1e6 });
    await again.init();
    expect(again.all('tasks').map((t) => t.name)).toEqual(['Draft']);
    expect(again.pendingCount()).toBe(1);
  });
});

describe('sample firm', () => {
  const today = '2026-10-12';
  const data = buildSampleData(today);
  const c = data.collections;

  it('fills every collection and is deterministic', () => {
    for (const name of COLLECTIONS) expect(Array.isArray(c[name])).toBe(true);
    expect(JSON.stringify(buildSampleData(today))).toBe(JSON.stringify(data));
  });

  it('is internally consistent: billed work points at real bills, ids are unique', () => {
    const billIds = new Set(c.bills.map((b) => b.id));
    for (const a of c.activities) if (a.billId) expect(billIds.has(a.billId)).toBe(true);
    for (const coll of COLLECTIONS) expect(new Set(c[coll].map((r) => r.id)).size).toBe(c[coll].length);
    for (const m of c.matters) expect(c.contacts.some((x) => x.id === m.clientId)).toBe(true);
  });

  it('never overdraws trust and never overpays a bill', () => {
    for (const m of c.matters) expect(trustBalance(m.id, c.transactions, c.accounts)).toBeGreaterThanOrEqual(0);
    for (const b of c.bills) {
      const paid = c.payments.filter((p) => p.billId === b.id).reduce((s, p) => s + p.amountCents, 0);
      expect(paid).toBeLessThanOrEqual(billTotals(b).total);
      expect(billBalance(b, c.payments)).toBeGreaterThanOrEqual(0);
    }
  });
});
