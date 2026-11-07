/**
 * Regression tests for the local-first store and sync engine.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const mem = (seed) => createMemoryBackend(seed, { bucketOf });

async function open(backend, opts = {}) {
  const store = createStore({ backend, flushDelay: 0, ...opts });
  await store.init();
  return store;
}

describe('sync races', () => {
  it('keeps a settings change that lands while a sync is reading settings', async () => {
    const backend = mem();
    const a = await open(backend);
    a.saveSettings({ company: { name: 'Old' } });
    await a.flush();
    // The read is served before the write, but its answer arrives after.
    const realSettings = backend.loadSettings;
    backend.loadSettings = async () => {
      const snap = await realSettings();
      await tick(30);
      return snap;
    };
    const syncing = a.sync({ force: true, only: ['settings'] });
    await tick(5);
    a.saveSettings({ company: { name: 'New' } });
    await a.flush();
    await syncing;
    expect(a.state.settings.company.name).toBe('New');
    backend.loadSettings = realSettings;
    await tick(50);
    // A later unrelated settings change must not bring the old name back.
    a.saveSettings({ currency: 'EUR' });
    await a.flush();
    expect(a.state.settings.company.name).toBe('New');
    const b = await open(backend);
    expect(b.state.settings.company.name).toBe('New');
  });
});

describe('reconnecting', () => {
  it('sends waiting changes as soon as a sync gets through, without sitting out the backoff', async () => {
    vi.useFakeTimers();
    try {
      const backend = mem();
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      backend.setFailing(true);
      store.put('vehicles', { name: 'Offline van' });
      await vi.advanceTimersByTimeAsync(1);
      // A few failed retries push the backoff up.
      await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000);
      expect(store.state.online).toBe(false);
      expect(backend.peek('vehicles')).toHaveLength(0);
      // The connection comes back and the 'online' event syncs.
      backend.setFailing(false);
      await store.sync();
      await vi.advanceTimersByTimeAsync(50);
      expect(backend.peek('vehicles')).toHaveLength(1);
      expect(store.pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('offline cache', () => {
  it('can write the cache right away when the page is hidden', async () => {
    const backend = mem();
    const saved = [];
    const cache = { load: async () => null, save: async (s) => void saved.push(structuredClone(s)) };
    const store = await open(backend, { cache });
    backend.setFailing(true);
    store.put('fuel', { date: '2026-10-05', volume: 3 });
    // The page is hidden right away: on a phone, timers stop with it.
    await store.persistCache();
    expect(saved.at(-1).pending.puts).toHaveLength(1);
    expect(saved.at(-1).collections.fuel).toHaveLength(1);
  });
});

describe('save status', () => {
  it('clears a rejected-change error once later changes save', async () => {
    const backend = mem();
    const store = await open(backend);
    const realPut = backend.putRecords;
    backend.putRecords = async (bucket, recs) => {
      if (bucket === 'vehicles') throw Object.assign(new Error('Your role does not allow this change.'), { status: 403 });
      return realPut(bucket, recs);
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.put('vehicles', { name: 'Not allowed' });
    await store.flush();
    err.mockRestore();
    expect(store.state.error).toMatch(/permission/);
    await tick(5);
    store.put('fuel', { date: '2026-10-03', volume: 10 });
    await store.flush();
    expect(backend.peek('fuel_202610')).toHaveLength(1);
    // "Not saved" must not stay on screen after this change saved.
    expect(store.state.error).toBe(null);
    backend.putRecords = realPut;
  });
});
