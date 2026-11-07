/**
 * Second review: coming back online.
 */
import { describe, it, expect, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

describe('coming back online', () => {
  it('sends unsaved changes as soon as a sync succeeds, not after the backoff', async () => {
    vi.useFakeTimers();
    try {
      const backend = createMemoryBackend();
      const store = createStore({ backend, flushDelay: 0 });
      await store.init();
      backend.setFailing(true);
      store.put('students', { firstName: 'Offline' });
      // Offline for a few minutes: the retry delay grows to a minute.
      await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 16000 + 32000 + 100);
      expect(store.state.online).toBe(false);
      backend.setFailing(false);
      await store.sync(); // the 'online' event or the tab regaining focus
      await vi.advanceTimersByTimeAsync(1000);
      expect(backend.peek('students')).toHaveLength(1);
      expect(store.pendingCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
