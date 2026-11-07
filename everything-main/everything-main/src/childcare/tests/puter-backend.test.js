import { describe, it, expect } from 'vitest';
import { createPuterBackend } from '../src/core/backend.js';
import { createStore } from '../src/core/store.js';
import { fakeKV } from './helpers.js';

describe('puter backend', () => {
  it('stores one KV item per record and pages through a collection', async () => {
    const kv = fakeKV({ pageSize: 2 });
    const backend = createPuterBackend({ kv });
    await backend.putRecords('students', [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    expect([...kv.data.keys()].sort()).toEqual(['cc1:r:students:a', 'cc1:r:students:b', 'cc1:r:students:c']);
    expect(kv.calls.set).toBe(1); // one batch request
    const { students } = await backend.loadCollections(['students']);
    expect(students.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    expect(kv.calls.list).toBe(2); // two pages
  });

  it('does not leak records between names sharing a prefix', async () => {
    const kv = fakeKV();
    const backend = createPuterBackend({ kv });
    await backend.putRecords('activities:2026-10-01', [{ id: '1' }]);
    await backend.putRecords('activities:2026-10-11', [{ id: '2' }]);
    await kv.set('cc1:r:studentsArchive:1', { id: 'x' });
    await backend.putRecords('students', [{ id: 's' }]);
    const res = await backend.loadCollections(['activities:2026-10-01', 'students']);
    expect(res['activities:2026-10-01']).toEqual([{ id: '1' }]);
    expect(res.students).toEqual([{ id: 's' }]);
  });

  it('keeps versions in small meta items: static, per month of days, and threads', async () => {
    const kv = fakeKV();
    const backend = createPuterBackend({ kv });
    const v = await backend.bumpVersions(['students', 'activities:2026-10-12', 'attendance:2026-10-12', 'messages:abc123', 'settings']);
    expect(v).toEqual({ students: 1, settings: 1, 'activities:2026-10-12': 1, 'attendance:2026-10-12': 1, 'messages:abc123': 1 });
    expect(kv.data.get('cc1:meta')).toEqual({ students: 1, settings: 1 });
    expect(kv.data.get('cc1:meta:d:2026-10')).toEqual({ activities12: 1, attendance12: 1 });
    expect(kv.data.get('cc1:meta:m')).toEqual({ tabc123: 1 });
    expect(await backend.loadMeta(['cc1:meta', 'cc1:meta:d:2026-10'])).toEqual({ students: 1, settings: 1, 'activities:2026-10-12': 1, 'attendance:2026-10-12': 1 });
  });

  it('reserves statement numbers atomically, alone or in blocks', async () => {
    const backend = createPuterBackend({ kv: fakeKV() });
    expect(await backend.nextNumber('invoice')).toBe(1);
    expect(await backend.nextNumber('invoice', 1, 3)).toBe(2);
    expect(await backend.nextNumber('invoice')).toBe(5);
    expect(await backend.nextNumber('invoice', 100)).toBe(100);
  });

  it('syncs two devices through the version map with minimal reads', async () => {
    const kv = fakeKV();
    const a = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0 });
    const b = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0 });
    await a.init();
    await b.init();
    a.put('students', { firstName: 'Ada' });
    await a.flush();
    const listsBefore = kv.calls.list;
    await b.sync();
    expect(b.all('students').map((c) => c.firstName)).toEqual(['Ada']);
    expect(kv.calls.list - listsBefore).toBe(1); // only students re-read
    const before = kv.calls.list;
    await b.sync();
    expect(kv.calls.list).toBe(before); // nothing changed: one get, no lists
  });

  it('touches only the day that changed', async () => {
    const kv = fakeKV();
    const a = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0 });
    const b = createStore({ backend: createPuterBackend({ kv }), flushDelay: 0 });
    await a.init();
    await b.init();
    await a.open(['activities:2026-10-11', 'activities:2026-10-12']);
    await b.open(['activities:2026-10-12']);
    b.put('activities:2026-10-12', { type: 'nap' });
    await b.flush();
    const before = kv.calls.list;
    await a.sync();
    expect(kv.calls.list - before).toBe(1);
    expect(a.all('activities:2026-10-12')).toHaveLength(1);
  });
});
