/**
 * Second review: KV reads a sync does not need.
 */
import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { tick } from './helpers.js';

const loads = (backend) => backend.calls.filter((c) => c[0] === 'loadCollections').flatMap((c) => c[1]);

describe('a write overlapping a sync of something else', () => {
  it('does not re-read the partition it wrote when the sync reloaded only another collection', async () => {
    const day = 'activities:2026-10-12';
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    const b = createStore({ backend, flushDelay: 0 });
    await a.init();
    await b.init();
    await a.open([day]);
    // Someone else wrote a message thread, so a's next sync reloads threads.
    b.put('threads', { id: 'k1', lastText: 'Hi' });
    await b.flush();

    // a logs a nap; its write is slow, and the interval sync runs meanwhile.
    const realPut = backend.putRecords;
    let release;
    backend.putRecords = async (...args) => {
      await new Promise((r) => (release = r));
      return realPut(...args);
    };
    a.put(day, { type: 'nap' });
    await tick(1);
    await a.sync();
    backend.calls.length = 0;
    backend.putRecords = realPut;
    release();
    await a.flush();
    await tick(5);
    expect(loads(backend)).not.toContain(day);
    expect(a.all('threads')).toHaveLength(1);
    expect(a.all(day)).toHaveLength(1);
  });
});

describe('reading a report range', () => {
  const day = 'attendance:2026-10-20';

  it('shows another device\'s later edit of a record this device wrote without opening the day', async () => {
    const backend = createMemoryBackend();
    const family = createStore({ backend, flushDelay: 0 });
    const office = createStore({ backend, flushDelay: 0 });
    await family.init();
    await office.init();
    // A family reports an absence for next week without opening that day.
    const rec = family.put(day, { id: 's-k1', studentId: 'k1', absent: { reason: 'Sick' } });
    await family.flush();
    await office.open([day]);
    office.patch(day, rec.id, { absent: { reason: 'Vacation' } });
    await office.flush();
    const res = await family.read([day]);
    expect(res[day].map((r) => r.absent.reason)).toEqual(['Vacation']);
  });

  it('leaves out a record deleted on this device but not sent yet', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    await a.init();
    const rec = a.put(day, { id: 's-k1', studentId: 'k1', absent: { reason: 'Sick' } });
    await a.flush();
    backend.setFailing(true);
    a.remove(day, rec.id);
    await a.flush();
    backend.setFailing(false);
    const res = await a.read([day]);
    expect(res[day]).toEqual([]);
  });

  it('still returns a day that was open when the read began but got evicted meanwhile', async () => {
    const collections = {};
    for (let d = 1; d <= 4; d++) collections[`activities:2026-10-0${d}`] = [{ id: `x${d}` }];
    const backend = createMemoryBackend({ collections });
    const store = createStore({ backend, flushDelay: 0, maxPartitions: 1 });
    await store.init();
    await store.open(['activities:2026-10-01']);
    // The report's read is slow; meanwhile the person opens another day.
    const realLoad = backend.loadCollections;
    let release;
    backend.loadCollections = async (names) => {
      const res = await realLoad(names);
      if (names.includes('activities:2026-10-04')) await new Promise((r) => (release = r));
      return res;
    };
    const reading = store.read(['activities:2026-10-01', 'activities:2026-10-04']);
    await tick(2);
    await store.open(['activities:2026-10-03']); // evicts 10-01
    expect(store.isOpen('activities:2026-10-01')).toBe(false);
    release();
    const res = await reading;
    expect(res['activities:2026-10-01']).toEqual([{ id: 'x1' }]);
  });
});
