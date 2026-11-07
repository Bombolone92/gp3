/**
 * Regression tests for sync races: a sync overlapping a write in flight,
 * a failed first load, document numbers across devices.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { quoteToJob } from '../src/core/workflow.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('store races', () => {
  it('keeps an edit that a sync reloads while it is being sent', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    await a.init();
    const job = a.put('jobs', { title: 'old' });
    await a.flush();

    // Slow down the next write so a sync lands in the middle of it.
    const realPut = backend.putRecords;
    let release;
    backend.putRecords = async (...args) => {
      await new Promise((r) => (release = r));
      return realPut(...args);
    };
    a.patch('jobs', job.id, { title: 'new' });
    const flushing = a.flush();
    await tick(5);
    await a.sync({ force: true });
    expect(a.get('jobs', job.id).title).toBe('new');
    release();
    await flushing;
    backend.putRecords = realPut;
    await a.sync();
    expect(a.get('jobs', job.id).title).toBe('new');
    expect(backend.peek('jobs')[0].title).toBe('new');

    a.put('jobs', { title: 'another' });
    await a.flush();
    expect(backend.peek('jobs').find((j) => j.id === job.id).title).toBe('new');
  });

  it('keeps a write that lands while a sync is reading the collection', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    await a.init();
    const job = a.put('jobs', { title: 'Mow', visits: [{ id: 'v1', completedAt: null }] });
    a.saveSettings({ business: { name: 'Old' } });
    await a.flush();

    // The read is served before the write, but its answer arrives after.
    const realLoad = backend.loadCollection;
    const realSettings = backend.loadSettings;
    backend.loadCollection = async (n) => {
      const snap = await realLoad(n);
      await tick(30);
      return snap;
    };
    backend.loadSettings = async () => {
      const snap = await realSettings();
      await tick(30);
      return snap;
    };
    let syncing = a.sync({ force: true, only: ['jobs'] });
    await tick(5);
    a.patch('jobs', job.id, (j) => ((j.visits[0].completedAt = '2026-10-12T10:00:00Z'), j));
    await a.flush();
    await syncing;
    expect(a.get('jobs', job.id).visits[0].completedAt).toBe('2026-10-12T10:00:00Z');
    await tick(80); // let the follow-up read finish

    syncing = a.sync({ force: true, only: ['settings'] });
    await tick(5);
    a.saveSettings({ business: { name: 'New' } });
    await a.flush();
    await syncing;
    expect(a.state.settings.business.name).toBe('New');

    backend.loadCollection = realLoad;
    backend.loadSettings = realSettings;
    await tick(5);
    await a.sync({ force: true });
    expect(a.get('jobs', job.id).visits[0].completedAt).toBe('2026-10-12T10:00:00Z');
    expect(a.state.settings.business.name).toBe('New');
  });

  it('tells other devices about writes that landed before the server rejected one', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 1e9 });
    const b = createStore({ backend, flushDelay: 1e9 });
    await a.init();
    await b.init();
    const realPut = backend.putRecords;
    backend.putRecords = async (name, recs) => {
      if (name === 'jobs') throw Object.assign(new Error('too large'), { status: 413 });
      return realPut(name, recs);
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    a.put('clients', { firstName: 'New client' });
    a.put('jobs', { title: 'Huge job' });
    await a.flush();
    await tick();
    err.mockRestore();
    await b.sync();
    expect(b.all('clients').map((c) => c.firstName)).toEqual(['New client']);
  });

  it('still sends the other changes when the server refuses one record', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 1e9 });
    await a.init();
    const gone = a.put('clients', { firstName: 'To delete' });
    await a.flush();
    const realPut = backend.putRecords;
    backend.putRecords = async (name, recs) => {
      if (recs.some((r) => r.bad)) throw Object.assign(new Error('bad record'), { status: 400 });
      return realPut(name, recs);
    };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    a.put('jobs', { title: 'Refused', bad: true });
    a.put('jobs', { title: 'Fine' });
    a.put('invoices', { number: 5 });
    a.remove('clients', gone.id);
    a.saveSettings({ company: { name: 'Acme' } });
    await a.flush();
    err.mockRestore();
    expect(backend.peek('jobs').map((j) => j.title)).toEqual(['Fine']);
    expect(backend.peek('invoices')).toHaveLength(1);
    expect(backend.peek('clients')).toHaveLength(0);
    expect((await backend.loadSettings()).company.name).toBe('Acme');
    expect(a.state.error).toMatch(/rejected/);
    expect(a.pendingCount()).toBe(0);
  });

  it('does not treat a failed first load as an empty account', async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend({ collections: { clients: [{ id: 'c1', firstName: 'Real' }] } });
      // Give the backend a version so the data counts as written.
      await backend.bumpVersions(['clients']);
      backend.setFailing(true);
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      expect(store.state.synced).toBe(false);
      store.put('clients', { firstName: 'Offline add' });
      backend.setFailing(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(store.state.synced).toBe(true);
      expect(store.state.remoteEmpty).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      await store.sync();
      expect(store.all('clients').map((c) => c.firstName).sort()).toEqual(['Offline add', 'Real']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed sync, not just unsent changes, so it does not stay offline', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const backend = createMemoryBackend();
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      backend.setFailing(true);
      await store.sync();
      expect(store.state.online).toBe(false);
      backend.setFailing(false);
      await vi.advanceTimersByTimeAsync(2500);
      expect(store.state.online).toBe(true);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('sends waiting changes as soon as a sync gets through, not when the retry backoff is up', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const backend = createMemoryBackend();
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      backend.setFailing(true);
      store.put('clients', { firstName: 'Added offline' });
      await vi.advanceTimersByTimeAsync(14_100); // three failed retries; the next is 16 s away
      backend.setFailing(false);
      await store.sync(); // the connection is back
      await vi.advanceTimersByTimeAsync(100);
      expect(backend.peek('clients')).toHaveLength(1);
      expect(store.pendingCount()).toBe(0);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('runs a full sync asked for while a sync of one collection is running', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 0 });
    await a.init();
    await b.init();
    b.put('jobs', { title: 'Mow' });
    await b.flush();
    const realLoad = backend.loadCollection;
    backend.loadCollection = async (n) => (await tick(20), realLoad(n));
    const partial = a.sync({ only: ['jobs'] });
    await tick(5);
    b.put('clients', { firstName: 'New elsewhere' });
    await b.flush();
    await a.sync();
    await partial;
    expect(a.all('clients').map((c) => c.firstName)).toEqual(['New elsewhere']);
    expect(a.all('jobs')).toHaveLength(1);
  });

  it('reports a brand new backend as empty', async () => {
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 0 });
    await store.init();
    expect(store.state.synced).toBe(true);
    expect(store.state.remoteEmpty).toBe(true);
  });

  it('keeps a setting changed on another device when this one saves a different setting', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 0 });
    await a.init();
    await b.init();
    a.saveSettings({ company: { phone: '555-0100' } });
    await a.flush();
    // b has not synced since, so its copy still has the old phone number.
    b.saveSettings({ company: { name: 'Acme' }, setupDismissed: true });
    await b.flush();
    await tick();
    await a.sync();
    expect((await backend.loadSettings()).company).toMatchObject({ phone: '555-0100', name: 'Acme' });
    expect(a.state.settings.company).toMatchObject({ phone: '555-0100', name: 'Acme' });
    expect(b.state.settings.company).toMatchObject({ phone: '555-0100', name: 'Acme' });
  });

  it('shows settings changed elsewhere while this device still has a settings change to send', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 1e9 });
    await a.init();
    await b.init();
    b.saveSettings({ currency: 'EUR' });
    a.saveSettings({ company: { name: 'Acme' } });
    await a.flush();
    await b.sync();
    expect(b.state.settings).toMatchObject({ currency: 'EUR', company: { name: 'Acme' } });
  });

  it('never hands out the same number on two devices after numbers jumped ahead', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 0 });
    await a.init();
    await b.init();
    a.saveSettings({ numbering: { invoice: 1000 } });
    await a.flush();
    await b.sync();
    const [n1, n2] = await Promise.all([a.nextNumber('invoices'), b.nextNumber('invoices')]);
    expect(new Set([n1, n2]).size).toBe(2);
    expect(Math.min(n1, n2)).toBe(1000);
  });

  it('includes writes in flight in the offline cache', async () => {
    const saved = [];
    const cache = { load: async () => null, save: async (s) => void saved.push(structuredClone(s)) };
    const backend = createMemoryBackend();
    const store = createStore({ backend, cache, flushDelay: 0 });
    await store.init();
    backend.putRecords = () => new Promise(() => {}); // never settles
    store.put('clients', { firstName: 'Hanging' });
    store.flush();
    await tick(700);
    expect(saved.at(-1).pending.puts).toHaveLength(1);
  });

  it('stops writing the offline cache once closed, so a cleared cache stays cleared', async () => {
    const saved = [];
    const cache = { load: async () => null, save: async (s) => void saved.push(s) };
    const store = createStore({ backend: createMemoryBackend(), cache, flushDelay: 0 });
    await store.init();
    await tick(700);
    saved.length = 0;
    store.put('clients', { firstName: 'Just added' });
    await store.close();
    await tick(700);
    store.put('clients', { firstName: 'After closing' });
    await tick(700);
    expect(saved).toHaveLength(0);
    // Signing out with unsent changes was confirmed already: the page may
    // go without asking again.
    expect(store.pendingCount()).toBe(0);
  });

  it('gives up on a request that never answers', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0, timeoutMs: 50 });
    await store.init();
    const real = backend.putRecords;
    backend.putRecords = () => new Promise(() => {});
    store.put('clients', { firstName: 'Slow' });
    await store.flush();
    expect(store.state.online).toBe(false);
    expect(store.pendingCount()).toBe(1);
    backend.putRecords = real;
  });

  it('converts a quote only once on a double click', async () => {
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 10_000 });
    await store.init();
    const q = store.put('quotes', { number: 1, clientId: 'c', items: [] });
    const [j1, j2] = await Promise.all([quoteToJob(store, q.id), quoteToJob(store, q.id)]);
    expect(j1.id).toBe(j2.id);
    expect(store.all('jobs')).toHaveLength(1);
  });
});
