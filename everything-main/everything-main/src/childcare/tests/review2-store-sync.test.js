/**
 * Second review: syncs asked for while another is running.
 */
import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { tick } from './helpers.js';

describe('forced syncs', () => {
  it('keeps force when the sync is queued behind one already running (access changed after a cached start)', async () => {
    // The cache knows two children; the school server now sends only one
    // (k2 was unlinked from this family) without any version moving.
    const backend = createMemoryBackend({ collections: { students: [{ id: 'k1', firstName: 'Mine' }] } });
    const snap = {
      v: 2,
      collections: { students: [{ id: 'k1', firstName: 'Mine' }, { id: 'k2', firstName: 'Unlinked' }] },
      loaded: [],
      settings: {},
      known: { students: 1 },
      synced: true,
      pending: { puts: [], dels: [], settings: false },
    };
    const cache = { load: async () => structuredClone(snap), save: async () => {} };
    const store = createStore({ backend, cache, flushDelay: 0 });
    await store.init(); // starts a background sync
    await store.sync({ force: true }); // what main.js does when access changed
    await tick(5);
    expect(store.all('students').map((s) => s.id)).toEqual(['k1']);
  });

  it('shows the server copy again after a rejected write even when a sync is running', async () => {
    const day = 'attendance:2026-10-12';
    const backend = createMemoryBackend();
    const store = createStore({ backend, flushDelay: 10_000 });
    await store.init();
    await store.open([day]);
    const realPut = backend.putRecords;
    backend.putRecords = async (name, recs) => {
      if (name === day) throw Object.assign(new Error('Refused'), { status: 409 });
      return realPut(name, recs);
    };
    // Keep a sync running while the rejection comes back.
    const realMeta = backend.loadMeta;
    let release;
    backend.loadMeta = async (...a) => {
      await new Promise((r) => (release = r));
      return realMeta(...a);
    };
    const running = store.sync();
    store.put(day, { id: 's-k1', studentId: 'k1', absent: { reason: 'Sick' } });
    await store.flush();
    backend.loadMeta = realMeta;
    release();
    await running;
    await tick(5);
    expect(store.get(day, 's-k1')).toBeNull();
  });
});


describe('awaiting a sync', () => {
  it('resolves only after the names asked for are synced, even behind a running sync (billing run re-check)', async () => {
    const backend = createMemoryBackend();
    const admin1 = createStore({ backend, flushDelay: 0 });
    const admin2 = createStore({ backend, flushDelay: 0 });
    await admin1.init();
    await admin2.init();
    // admin2's interval sync is under way when admin1's statements land.
    const realMeta = backend.loadMeta;
    let release;
    backend.loadMeta = async (...a) => {
      const res = await realMeta(...a); // read before the statements land
      await new Promise((r) => (release = r));
      return res;
    };
    const interval = admin2.sync();
    backend.loadMeta = realMeta;
    admin1.put('invoices', { studentId: 'k1', period: 'monthly:2026-10' });
    await admin1.flush();
    release();
    // The billing dialog re-checks before creating statements.
    await admin2.sync({ only: ['invoices'] });
    expect(admin2.all('invoices')).toHaveLength(1);
    await interval;
  });
});
