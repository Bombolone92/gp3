/**
 * Second review: retrying a batch that failed part way.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

describe('a batch that fails part way', () => {
  it('resends only what did not land', async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend();
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      const sent = [];
      const realPut = backend.putRecords;
      const realDel = backend.deleteRecords;
      let dropRooms = true;
      backend.putRecords = async (name, recs) => {
        sent.push(['put', name, recs.length]);
        if (name === 'rooms' && dropRooms) {
          dropRooms = false;
          throw Object.assign(new Error('Network error'), { code: 'network' });
        }
        return realPut(name, recs);
      };
      backend.deleteRecords = async (name, ids) => {
        sent.push(['del', name, ids.length]);
        return realDel(name, ids);
      };
      const old = store.put('students', { firstName: 'Old' });
      await vi.advanceTimersByTimeAsync(10);
      sent.length = 0;
      // A roster import: many children, a room, and a removal.
      store.bulkPut('students', Array.from({ length: 300 }, (_, i) => ({ firstName: `Child ${i}` })));
      store.put('rooms', { name: 'Sprouts' });
      store.remove('students', old.id);
      await vi.advanceTimersByTimeAsync(10);
      expect(store.state.online).toBe(false);
      await vi.advanceTimersByTimeAsync(3000); // the retry
      expect(store.pendingCount()).toBe(0);
      expect(backend.peek('students')).toHaveLength(300);
      expect(backend.peek('rooms')).toHaveLength(1);
      // The 300 children landed the first time; only the room and the removal are retried.
      expect(sent.filter(([k, n]) => k === 'put' && n === 'students')).toHaveLength(1);
      expect(sent.filter(([k, n]) => k === 'put' && n === 'rooms')).toHaveLength(2);
      expect(sent.filter(([k, n]) => k === 'del' && n === 'students')).toHaveLength(1);
      expect(backend.peek('students').some((s) => s.id === old.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still announces writes that landed when the version bump failed and the app was closed', async () => {
    const saved = [];
    const cache = { load: async () => saved.at(-1) ?? null, save: async (snap) => void saved.push(structuredClone(snap)) };
    const backend = createMemoryBackend();
    const other = createStore({ backend, flushDelay: 0 });
    await other.init();
    const first = createStore({ backend, cache, flushDelay: 0 });
    await first.init();
    const realBump = backend.bumpVersions;
    backend.bumpVersions = async () => {
      throw Object.assign(new Error('Network error'), { code: 'network' });
    };
    first.put('students', { firstName: 'Landed' });
    await first.flush();
    expect(backend.peek('students')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 700)); // the snapshot is saved; then the tab closes
    backend.bumpVersions = realBump;

    const second = createStore({ backend, cache, flushDelay: 0 });
    await second.init();
    await second.flush();
    await other.sync();
    expect(other.all('students').map((s) => s.firstName)).toEqual(['Landed']);
  });
});
