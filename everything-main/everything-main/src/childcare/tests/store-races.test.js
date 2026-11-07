/**
 * Regression tests for sync races: a sync overlapping a write in flight,
 * a failed first load, document numbers across devices.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

import { tick } from './helpers.js';

describe('store races', () => {
  it('keeps an edit that a sync reloads while it is being sent', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    await a.init();
    const job = a.put('students', { firstName: 'old' });
    await a.flush();

    // Slow down the next write so a sync lands in the middle of it.
    const realPut = backend.putRecords;
    let release;
    backend.putRecords = async (...args) => {
      await new Promise((r) => (release = r));
      return realPut(...args);
    };
    a.patch('students', job.id, { firstName: 'new' });
    const flushing = a.flush();
    await tick(5);
    await a.sync({ force: true });
    expect(a.get('students', job.id).firstName).toBe('new');
    release();
    await flushing;
    backend.putRecords = realPut;
    await a.sync();
    expect(a.get('students', job.id).firstName).toBe('new');
    expect(backend.peek('students')[0].firstName).toBe('new');

    a.put('students', { firstName: 'another' });
    await a.flush();
    expect(backend.peek('students').find((j) => j.id === job.id).firstName).toBe('new');
  });

  it('does not treat a failed first load as an empty account', async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend({ collections: { students: [{ id: 'c1', firstName: 'Real' }] } });
      // Give the backend a version so the data counts as written.
      await backend.bumpVersions(['students']);
      backend.setFailing(true);
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      expect(store.state.synced).toBe(false);
      store.put('students', { firstName: 'Offline add' });
      backend.setFailing(false);
      await vi.advanceTimersByTimeAsync(5000);
      expect(store.state.synced).toBe(true);
      expect(store.state.remoteEmpty).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      await store.sync();
      expect(store.all('students').map((c) => c.firstName).sort()).toEqual(['Offline add', 'Real']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a brand new backend as empty', async () => {
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 0 });
    await store.init();
    expect(store.state.synced).toBe(true);
    expect(store.state.remoteEmpty).toBe(true);
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
    store.put('students', { firstName: 'Hanging' });
    store.flush();
    await tick(700);
    expect(saved.at(-1).pending.puts).toHaveLength(1);
  });

  it('gives up on a request that never answers', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 0, timeoutMs: 50 });
    await store.init();
    const real = backend.putRecords;
    backend.putRecords = () => new Promise(() => {});
    store.put('students', { firstName: 'Slow' });
    await store.flush();
    expect(store.state.online).toBe(false);
    expect(store.pendingCount()).toBe(1);
    backend.putRecords = real;
  });
});

describe('rejected writes', () => {
  it('keeps the other collections of a batch when the server refuses one', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 10_000 });
    await store.init();
    const real = backend.putRecords;
    backend.putRecords = async (name, recs) => {
      if (name === 'attendance:2026-10-12') throw Object.assign(new Error('Your child is already checked in today.'), { status: 409 });
      return real(name, recs);
    };
    store.put('attendance:2026-10-12', { id: 's-k1', studentId: 'k1', absent: { reason: 'Sick' } });
    store.put('messages:k1', { text: 'Hi' });
    store.put('threads', { id: 'k1', lastText: 'Hi' });
    const seen = [];
    store.subscribe((c) => c.has('rejected') && seen.push('rejected'));
    await store.flush();
    await tick();
    expect(backend.peek('messages:k1')).toHaveLength(1);
    expect(backend.peek('threads')).toHaveLength(1);
    expect(store.pendingCount()).toBe(0);
    expect(seen).toEqual(['rejected']);
    expect(store.state.error).toMatch(/already checked in/);
    // The server's copy comes back instead of the refused one.
    await tick(5);
    expect(store.get('attendance:2026-10-12', 's-k1')).toBeNull();
  });
});
