import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { tick } from './helpers.js';

async function open(backend, opts = {}) {
  const store = createStore({ backend, flushDelay: 0, ...opts });
  await store.init();
  return store;
}

const loads = (backend) => backend.calls.filter((c) => c[0] === 'loadCollections').flatMap((c) => c[1]);

describe('store', () => {
  it('applies writes locally and persists them to the backend', async () => {
    const backend = createMemoryBackend();
    const store = await open(backend);
    const s = store.put('students', { firstName: 'Ada' });
    expect(store.get('students', s.id).firstName).toBe('Ada');
    await store.flush();
    expect(backend.peek('students')).toHaveLength(1);
    store.remove('students', s.id);
    await store.flush();
    expect(backend.peek('students')).toHaveLength(0);
  });

  it('notifies subscribers once per burst, with base names for partitions', async () => {
    const store = await open(createMemoryBackend(), { flushDelay: 1000 });
    const fn = vi.fn();
    store.subscribe(fn);
    store.put('students', { firstName: 'A' });
    store.put('activities:2026-10-12', { type: 'note' });
    await tick();
    expect(fn).toHaveBeenCalledTimes(1);
    expect([...fn.mock.calls[0][0]]).toEqual(expect.arrayContaining(['students', 'activities:2026-10-12', 'activities']));
  });

  it('rejects unknown collections and malformed partitions', async () => {
    const store = await open(createMemoryBackend());
    expect(() => store.put('secrets', { a: 1 })).toThrow();
    expect(() => store.put('activities:yesterday', { a: 1 })).toThrow();
    expect(() => store.put('messages:../x', { a: 1 })).toThrow();
  });

  it('picks up another device\'s changes on sync, reading only what moved', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    const b = await open(backend);
    a.put('students', { firstName: 'From A' });
    await a.flush();
    backend.calls.length = 0;
    await b.sync();
    expect(b.all('students').map((c) => c.firstName)).toEqual(['From A']);
    expect(loads(backend)).toEqual(['students']);
  });

  it('notices concurrent writes when bumping versions', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    const b = await open(backend);
    b.put('students', { firstName: 'B' });
    await b.flush();
    a.put('students', { firstName: 'A' });
    await a.flush();
    await tick();
    await a.sync();
    expect(a.all('students').map((c) => c.firstName).sort()).toEqual(['A', 'B']);
  });

  it('keeps writes while offline and sends them later', async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend();
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      backend.setFailing(true);
      store.put('students', { firstName: 'Offline' });
      await vi.advanceTimersByTimeAsync(10);
      expect(store.state.online).toBe(false);
      expect(store.pendingCount()).toBe(1);
      backend.setFailing(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(store.state.online).toBe(true);
      expect(backend.peek('students')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens from the cache and replays unsent writes, partitions included', async () => {
    const saved = [];
    const cache = { load: async () => saved.at(-1) ?? null, save: async (s) => void saved.push(structuredClone(s)) };
    const backend = createMemoryBackend();
    backend.setFailing(true);
    const first = createStore({ backend, cache, flushDelay: 0 });
    await first.init().catch(() => {});
    first.put('students', { firstName: 'Cached' });
    first.put('attendance:2026-10-12', { id: 's-x', studentId: 'x', events: [] });
    await tick(700);
    expect(saved.length).toBeGreaterThan(0);

    backend.setFailing(false);
    const second = createStore({ backend, cache, flushDelay: 0 });
    await second.init();
    expect(second.all('students')[0].firstName).toBe('Cached');
    expect(second.get('attendance:2026-10-12', 's-x')).not.toBeNull();
    await second.flush();
    expect(backend.peek('students')).toHaveLength(1);
    expect(backend.peek('attendance:2026-10-12')).toHaveLength(1);
  });

  it('hands out increasing statement numbers that respect existing ones, in blocks', async () => {
    const store = await open(createMemoryBackend());
    expect(await store.nextNumber('invoices')).toBe(1001);
    store.put('invoices', { number: 1041 });
    expect(await store.nextNumber('invoices')).toBe(1042);
    const first = await store.nextNumber('invoices', 5);
    expect(first).toBe(1043);
    expect(await store.nextNumber('invoices')).toBe(1048);
  });

  it('saves settings with a deep merge', async () => {
    const backend = createMemoryBackend();
    const store = await open(backend);
    store.saveSettings({ school: { name: 'Acorn' } });
    expect(store.state.settings.school.name).toBe('Acorn');
    expect(store.state.settings.school.phone).toBe('');
    await store.flush();
    expect((await backend.loadSettings()).school.name).toBe('Acorn');
  });

  it('can undo a removal', async () => {
    const store = await open(createMemoryBackend());
    const c = store.put('students', { firstName: 'Z' });
    const removed = store.remove('students', c.id);
    store.restore('students', removed);
    expect(store.get('students', c.id)).not.toBeNull();
  });
});

describe('partitions', () => {
  const day = 'activities:2026-10-12';
  const other = 'activities:2026-10-11';

  it('loads a partition only when opened, then keeps it synced', async () => {
    const backend = createMemoryBackend({ collections: { [day]: [{ id: 'a1', type: 'nap' }], [other]: [{ id: 'a2', type: 'meal' }] } });
    const a = await open(backend);
    expect(loads(backend)).not.toContain(day);
    expect(a.all(day)).toEqual([]);
    expect(await a.open([day])).toBe(true);
    expect(a.all(day).map((r) => r.id)).toEqual(['a1']);
    expect(a.isOpen(other)).toBe(false);

    const b = await open(backend);
    await b.open([day]);
    b.put(day, { id: 'a3', type: 'note' });
    await b.flush();
    backend.calls.length = 0;
    await a.sync();
    expect(a.all(day).map((r) => r.id).sort()).toEqual(['a1', 'a3']);
    expect(loads(backend)).toEqual([day]);
  });

  it('skips partitions that were never written', async () => {
    const backend = createMemoryBackend();
    const store = await open(backend);
    backend.calls.length = 0;
    expect(await store.open(['attendance:2026-01-05'])).toBe(true);
    expect(loads(backend)).toEqual([]);
  });

  it('reads one round trip for several partitions', async () => {
    const backend = createMemoryBackend({ collections: { [day]: [{ id: 'a1' }], [other]: [{ id: 'a2' }] } });
    const store = await open(backend);
    backend.calls.length = 0;
    await store.open([day, other]);
    expect(backend.calls.filter((c) => c[0] === 'loadCollections')).toHaveLength(1);
  });

  it('evicts the least recently used partitions beyond the cap', async () => {
    const collections = {};
    for (let d = 1; d <= 5; d++) collections[`activities:2026-10-0${d}`] = [{ id: `x${d}` }];
    const store = await open(createMemoryBackend({ collections }), { maxPartitions: 3 });
    for (let d = 1; d <= 5; d++) {
      await store.open([`activities:2026-10-0${d}`]);
      await tick(2);
    }
    expect(store.isOpen('activities:2026-10-05')).toBe(true);
    expect(store.isOpen('activities:2026-10-01')).toBe(false);
  });

  it('reads report ranges without keeping them', async () => {
    const backend = createMemoryBackend({ collections: { [day]: [{ id: 'a1' }] } });
    const store = await open(backend);
    const res = await store.read([day, 'activities:2026-10-13']);
    expect(res[day]).toHaveLength(1);
    expect(res['activities:2026-10-13']).toEqual([]);
    expect(store.isOpen(day)).toBe(false);
  });

  it('learns which days hold data from the meta alone', async () => {
    const backend = createMemoryBackend({ collections: { [day]: [{ id: 'a1' }], [other]: [{ id: 'a2' }] } });
    const store = await open(backend);
    await store.peekMeta(['cc1:meta:d:2026-10']);
    expect(store.knownPartitions('activities')).toEqual([other, day]);
  });
});
