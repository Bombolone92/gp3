import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

async function open(backend, opts = {}) {
  const store = createStore({ backend, flushDelay: 0, ...opts });
  await store.init();
  return store;
}

describe('store', () => {
  it('applies writes locally and persists them to the backend', async () => {
    const backend = createMemoryBackend();
    const store = await open(backend);
    const c = store.put('clients', { firstName: 'Ada' });
    expect(store.get('clients', c.id).firstName).toBe('Ada');
    await store.flush();
    expect(backend.peek('clients')).toHaveLength(1);
    store.remove('clients', c.id);
    await store.flush();
    expect(backend.peek('clients')).toHaveLength(0);
  });

  it('notifies subscribers once per burst of changes', async () => {
    const store = await open(createMemoryBackend(), { flushDelay: 1000 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.put('clients', { firstName: 'A' });
    store.put('jobs', { title: 'B' });
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0][0]]).toEqual(expect.arrayContaining(['clients', 'jobs']));
  });

  it('picks up another device\'s changes on sync, reading only what moved', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    const b = await open(backend);
    a.put('clients', { firstName: 'From A' });
    await a.flush();
    const spy = vi.spyOn(backend, 'loadCollection');
    await b.sync();
    expect(b.all('clients').map((c) => c.firstName)).toEqual(['From A']);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['clients']);
  });

  it('notices concurrent writes when bumping versions', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    const b = await open(backend);
    b.put('clients', { firstName: 'B' });
    await b.flush();
    a.put('clients', { firstName: 'A' });
    await a.flush();
    await tick();
    await a.sync();
    expect(a.all('clients').map((c) => c.firstName).sort()).toEqual(['A', 'B']);
  });

  it('keeps writes while offline and sends them later', async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend();
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      backend.setFailing(true);
      store.put('clients', { firstName: 'Offline' });
      await vi.advanceTimersByTimeAsync(10);
      expect(store.state.online).toBe(false);
      expect(store.pendingCount()).toBe(1);
      backend.setFailing(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(store.state.online).toBe(true);
      expect(backend.peek('clients')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens from the cache and replays unsent writes', async () => {
    const saved = [];
    const cache = { load: async () => saved.at(-1) ?? null, save: async (s) => void saved.push(structuredClone(s)) };
    const backend = createMemoryBackend();
    backend.setFailing(true);
    const first = createStore({ backend, cache, flushDelay: 0 });
    await first.init().catch(() => {});
    first.put('clients', { firstName: 'Cached' });
    await new Promise((r) => setTimeout(r, 700));
    expect(saved.length).toBeGreaterThan(0);

    backend.setFailing(false);
    const second = createStore({ backend, cache, flushDelay: 0 });
    await second.init();
    expect(second.all('clients')[0].firstName).toBe('Cached');
    await second.flush();
    expect(backend.peek('clients')).toHaveLength(1);
  });

  it('hands out increasing document numbers that respect existing ones', async () => {
    const store = await open(createMemoryBackend());
    expect(await store.nextNumber('quotes')).toBe(1);
    store.put('quotes', { number: 41 });
    expect(await store.nextNumber('quotes')).toBe(42);
    store.saveSettings({ numbering: { invoice: 1000 } });
    expect(await store.nextNumber('invoices')).toBe(1000);
    // A damaged value (from a restored backup) is ignored, not numbered NaN.
    store.saveSettings({ numbering: { job: 'abc' } });
    expect(await store.nextNumber('jobs')).toBe(1);
  });

  it('saves settings with a deep merge', async () => {
    const backend = createMemoryBackend();
    const store = await open(backend);
    store.saveSettings({ company: { name: 'Acme' } });
    expect(store.state.settings.company.name).toBe('Acme');
    expect(store.state.settings.company.phone).toBe('');
    await store.flush();
    expect((await backend.loadSettings()).company.name).toBe('Acme');
  });

  it('can undo a removal', async () => {
    const store = await open(createMemoryBackend());
    const c = store.put('clients', { firstName: 'Z' });
    const removed = store.remove('clients', c.id);
    store.restore('clients', removed);
    expect(store.get('clients', c.id)).not.toBeNull();
  });
});
