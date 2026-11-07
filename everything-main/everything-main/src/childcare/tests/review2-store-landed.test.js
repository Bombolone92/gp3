/**
 * Second review: loads that overlap a write landing.
 */
import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { tick } from './helpers.js';

describe('a sync overlapping a write that lands', () => {
  it('does not put back the old copy of a record whose write landed while the sync was loading', async () => {
    const backend = createMemoryBackend();
    const a = createStore({ backend, flushDelay: 0 });
    await a.init();
    const kid = a.put('students', { firstName: 'Old', lastName: 'X' });
    await a.flush();

    // The sync reads the list before our write lands, and answers after.
    const realLoad = backend.loadCollections;
    let release;
    backend.loadCollections = async (names) => {
      const res = await realLoad(names); // snapshot taken now: still "Old"
      await new Promise((r) => (release = r));
      return res;
    };
    a.patch('students', kid.id, { firstName: 'New' });
    const syncing = a.sync({ force: true });
    await tick(5); // the debounced write goes out and lands meanwhile
    expect(backend.peek('students')[0].firstName).toBe('New');
    backend.loadCollections = realLoad;
    release();
    await syncing;
    expect(a.get('students', kid.id).firstName).toBe('New');

    // A later edit made on top of what the screen shows must not undo it.
    a.patch('students', kid.id, { lastName: 'Y' });
    await a.flush();
    expect(backend.peek('students')[0]).toMatchObject({ firstName: 'New', lastName: 'Y' });
  });

  it('does not drop an entry that landed while its partition was opening', async () => {
    const day = 'activities:2026-10-12';
    const backend = createMemoryBackend({ collections: { [day]: [{ id: 'a1', type: 'note' }] } });
    const a = createStore({ backend, flushDelay: 0 });
    await a.init();
    // The open reads the day before the new entry lands, and answers after.
    const realLoad = backend.loadCollections;
    let release;
    backend.loadCollections = async (names) => {
      const res = await realLoad(names);
      await new Promise((r) => (release = r));
      return res;
    };
    const opening = a.open([day]);
    await tick(1);
    backend.loadCollections = realLoad;
    a.put(day, { id: 'a2', type: 'nap' });
    await tick(5);
    expect(backend.peek(day).map((r) => r.id).sort()).toEqual(['a1', 'a2']);
    release();
    await opening;
    expect(a.all(day).map((r) => r.id).sort()).toEqual(['a1', 'a2']);
  });
});
