import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf, collOfBucket, isBucket } from '../src/core/schema.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function open(backend, opts = {}) {
  const store = createStore({ backend, flushDelay: 0, ...opts });
  await store.init();
  return store;
}

const mem = (seed) => createMemoryBackend(seed, { bucketOf });

describe('schema buckets', () => {
  it('puts small collections in one bucket and logs in monthly buckets', () => {
    expect(bucketOf('vehicles', { id: 'a' })).toBe('vehicles');
    expect(bucketOf('fuel', { date: '2026-10-12' })).toBe('fuel_202610');
    expect(bucketOf('fuel', { date: '' })).toBe('fuel_000000');
    expect(collOfBucket('fuel_202610')).toBe('fuel');
    expect(isBucket('fuel_202610')).toBe(true);
    expect(isBucket('fuel')).toBe(false);
    expect(isBucket('vehicles')).toBe(true);
    expect(isBucket('vehicles_202610')).toBe(false);
    expect(isBucket('nope')).toBe(false);
  });
});

describe('store', () => {
  it('applies writes locally and persists them to the right bucket', async () => {
    const backend = mem();
    const store = await open(backend);
    const v = store.put('vehicles', { name: 'Van 1' });
    const f = store.put('fuel', { vehicleId: v.id, date: '2026-10-03', volume: 10 });
    expect(store.get('vehicles', v.id).name).toBe('Van 1');
    await store.flush();
    expect(backend.peek('vehicles')).toHaveLength(1);
    expect(backend.peek('fuel_202610').map((r) => r.id)).toEqual([f.id]);
    store.remove('fuel', f.id);
    await store.flush();
    expect(backend.peek('fuel_202610')).toHaveLength(0);
  });

  it('moves a record between monthly buckets when its date changes', async () => {
    const backend = mem();
    const store = await open(backend);
    const f = store.put('fuel', { date: '2026-09-30', volume: 5 });
    await store.flush();
    store.patch('fuel', f.id, { date: '2026-10-01' });
    await store.flush();
    expect(backend.peek('fuel_202609')).toHaveLength(0);
    expect(backend.peek('fuel_202610')).toHaveLength(1);
    // Another device sees it once, in the new month.
    const other = await open(backend);
    expect(other.all('fuel')).toHaveLength(1);
    expect(other.get('fuel', f.id).date).toBe('2026-10-01');
  });

  it('notifies subscribers once per burst of changes', async () => {
    const store = await open(mem(), { flushDelay: 1000 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.put('vehicles', { name: 'A' });
    store.put('issues', { summary: 'B' });
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0][0]]).toEqual(expect.arrayContaining(['vehicles', 'issues']));
  });

  it("re-reads only the month another device changed", async () => {
    const backend = mem();
    const a = await open(backend);
    for (let m = 1; m <= 9; m++) a.put('fuel', { date: `2026-0${m}-10`, volume: m });
    await a.flush();
    const b = await open(backend);
    expect(b.all('fuel')).toHaveLength(9);

    a.put('fuel', { date: '2026-09-20', volume: 20 });
    await a.flush();
    const spy = vi.spyOn(backend, 'loadBucket');
    await b.sync();
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['fuel_202609']);
    expect(b.all('fuel')).toHaveLength(10);
  });

  it('notices concurrent writes when bumping versions', async () => {
    const backend = mem();
    const a = await open(backend);
    const b = await open(backend);
    b.put('vehicles', { name: 'B' });
    await b.flush();
    a.put('vehicles', { name: 'A' });
    await a.flush();
    await tick();
    await a.sync();
    expect(a.all('vehicles').map((c) => c.name).sort()).toEqual(['A', 'B']);
  });

  it('picks up a brand new month bucket created by another device', async () => {
    const backend = mem();
    const a = await open(backend);
    const b = await open(backend);
    a.put('meters', { date: '2026-11-02', value: 100 });
    await a.flush();
    await b.sync();
    expect(b.all('meters')).toHaveLength(1);
  });

  it('removes records another device deleted', async () => {
    const backend = mem();
    const a = await open(backend);
    const f = a.put('fuel', { date: '2026-10-01', volume: 1 });
    await a.flush();
    const b = await open(backend);
    expect(b.all('fuel')).toHaveLength(1);
    a.remove('fuel', f.id);
    await a.flush();
    await b.sync();
    expect(b.all('fuel')).toHaveLength(0);
  });

  it('keeps local edits while offline and sends them later', async () => {
    const backend = mem();
    const store = await open(backend);
    backend.setFailing(true);
    store.put('vehicles', { name: 'Offline van' });
    await store.flush();
    expect(store.state.online).toBe(false);
    expect(store.pendingCount()).toBe(1);
    backend.setFailing(false);
    await store.flush();
    expect(backend.peek('vehicles')).toHaveLength(1);
    expect(store.pendingCount()).toBe(0);
  });

  it('keeps an edit that a sync reloads while it is being sent', async () => {
    const backend = mem();
    const a = await open(backend);
    const f = a.put('fuel', { date: '2026-10-01', notes: 'old' });
    await a.flush();
    const realPut = backend.putRecords;
    let release;
    backend.putRecords = async (...args) => {
      await new Promise((r) => (release = r));
      return realPut(...args);
    };
    a.patch('fuel', f.id, { notes: 'new' });
    const flushing = a.flush();
    await tick(5);
    await a.sync({ force: true });
    expect(a.get('fuel', f.id).notes).toBe('new');
    release();
    await flushing;
    backend.putRecords = realPut;
    await a.sync();
    expect(a.get('fuel', f.id).notes).toBe('new');
    expect(backend.peek('fuel_202610')[0].notes).toBe('new');
  });

  it('restores from a cache snapshot including unsent writes', async () => {
    const backend = mem();
    let saved = null;
    const cache = { load: async () => saved, save: async (s) => (saved = structuredClone(s)) };
    const a = await open(backend, { cache });
    backend.setFailing(true);
    a.put('fuel', { date: '2026-10-05', volume: 3 });
    a.saveSettings({ company: { name: 'Acme' } });
    await a.flush();
    await tick(700);
    expect(saved.pending.puts).toHaveLength(1);
    expect(saved.pending.puts[0].bucket).toBe('fuel_202610');

    backend.setFailing(false);
    const b = createStore({ backend, cache, flushDelay: 0 });
    await b.init();
    expect(b.all('fuel')).toHaveLength(1);
    expect(b.state.settings.company.name).toBe('Acme');
    await b.flush();
    await tick();
    expect(backend.peek('fuel_202610')).toHaveLength(1);
  });

  it('hands out increasing numbers across devices', async () => {
    const backend = mem();
    const a = await open(backend);
    const b = await open(backend);
    const n1 = await a.nextNumber('issues');
    const n2 = await b.nextNumber('issues');
    const n3 = await a.nextNumber('issues');
    expect(new Set([n1, n2, n3]).size).toBe(3);
    expect(n3).toBeGreaterThan(n1);
  });

  it('starts numbering after numbers already in use', async () => {
    const backend = mem({ collections: { issues: [{ id: 'i1', number: 41 }] } });
    const a = await open(backend);
    expect(await a.nextNumber('issues')).toBe(42);
  });

  it('loads seeded buckets on first open', async () => {
    const backend = mem({
      collections: {
        vehicles: [{ id: 'v1', name: 'Truck' }],
        fuel: [
          { id: 'f1', date: '2026-08-01' },
          { id: 'f2', date: '2026-09-01' },
        ],
      },
    });
    const a = await open(backend);
    expect(a.all('vehicles')).toHaveLength(1);
    expect(a.all('fuel')).toHaveLength(2);
  });
});

describe('store write failures', () => {
  it('drops only a rejected bucket, sends the rest, and bumps what was written', async () => {
    const backend = mem();
    const owner = await open(backend);
    owner.put('vehicles', { id: 'v1', name: 'Van' });
    await owner.flush();
    const realPut = backend.putRecords;
    backend.putRecords = async (bucket, recs) => {
      if (bucket === 'vehicles') throw Object.assign(new Error('Your role does not allow this change.'), { status: 403 });
      return realPut(bucket, recs);
    };
    const driver = await open(backend);
    driver.put('fuel', { date: '2026-10-03', volume: 10 });
    driver.patch('vehicles', 'v1', { meter: 1200 });
    driver.put('issues', { summary: 'Light out' });
    await driver.flush();
    await tick(5);
    expect(backend.peek('fuel_202610')).toHaveLength(1);
    expect(backend.peek('issues')).toHaveLength(1);
    expect(driver.pendingCount()).toBe(0);
    expect(driver.state.error).toMatch(/permission/);
    // Another device sees the fuel and issue because their buckets were bumped.
    await owner.sync();
    expect(owner.all('fuel')).toHaveLength(1);
    expect(owner.all('issues')).toHaveLength(1);
    // The rejected change is replaced by what the server has.
    await tick(5);
    expect(driver.get('vehicles', 'v1').meter).toBeUndefined();
    backend.putRecords = realPut;
  });

  it('retries a version bump that failed after the write landed', async () => {
    const backend = mem();
    const a = await open(backend);
    const b = await open(backend);
    const realBump = backend.bumpVersions;
    backend.bumpVersions = async () => {
      throw Object.assign(new Error('network'), { code: 'network' });
    };
    a.put('vehicles', { name: 'Truck' });
    await a.flush();
    expect(backend.peek('vehicles')).toHaveLength(1);
    backend.bumpVersions = realBump;
    await a.flush();
    await b.sync();
    expect(b.all('vehicles')).toHaveLength(1);
  });

  it('ignores a load that raced a write to the same bucket', async () => {
    const backend = mem();
    const a = await open(backend);
    const v = a.put('vehicles', { name: 'Old' });
    await a.flush();
    // Hold the next load until the write has landed.
    const realLoad = backend.loadBucket;
    let release;
    backend.loadBucket = async (name) => {
      const snapshot = await realLoad(name);
      await new Promise((r) => (release = r));
      return snapshot;
    };
    const syncing = a.sync({ only: ['vehicles'], force: true });
    await tick(5);
    a.patch('vehicles', v.id, { name: 'New' });
    await a.flush();
    backend.loadBucket = realLoad;
    release();
    await syncing;
    await tick(10);
    expect(a.get('vehicles', v.id).name).toBe('New');
    expect(backend.peek('vehicles')[0].name).toBe('New');
  });
});
