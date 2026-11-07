/**
 * Second review: a change made just before the page is hidden or closed.
 */
import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

describe('page hidden right after a change', () => {
  it('can save the offline snapshot at once instead of 600 ms later', async () => {
    const saved = [];
    const cache = { load: async () => null, save: async (s) => void saved.push(structuredClone(s)) };
    const backend = createMemoryBackend();
    backend.setFailing(true);
    const store = createStore({ backend, cache, flushDelay: 250 });
    await store.init();
    saved.length = 0;
    store.put('students', { firstName: 'Checked in offline' });
    // The tablet is put to sleep or the app is swiped away now.
    store.persist();
    await Promise.resolve();
    expect(saved.at(-1)?.pending.puts).toHaveLength(1);
  });

  it('does not write the snapshot when nothing changed', async () => {
    const saved = [];
    const cache = { load: async () => null, save: async (s) => void saved.push(s) };
    const store = createStore({ backend: createMemoryBackend(), cache });
    await store.init();
    await new Promise((r) => setTimeout(r, 700));
    saved.length = 0;
    store.persist();
    expect(saved).toHaveLength(0);
  });
});
