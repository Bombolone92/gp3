import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { createSearchIndex } from '../src/core/search.js';

describe('search', () => {
  it("finds documents under their client's current name", async () => {
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 1e9 });
    await store.init();
    const c = store.put('clients', { firstName: 'Ann', lastName: 'Smyth' });
    store.put('jobs', { number: 4, title: 'Hedge trim', clientId: c.id });
    const search = createSearchIndex(store);
    const jobs = (q) => search(q).find((g) => g.coll === 'jobs')?.total || 0;
    expect(jobs('smyth')).toBe(1);
    store.patch('clients', c.id, { lastName: 'Smith' });
    expect(jobs('smith')).toBe(1);
    expect(jobs('smyth')).toBe(0);
  });

  it('lists the document with the typed number first', async () => {
    // Each save a minute later, so newer quotes would otherwise come first.
    let tick = 0;
    const store = createStore({ backend: createMemoryBackend(), flushDelay: 1e9, now: () => new Date(Date.UTC(2026, 0, 1, 0, tick++)).toISOString() });
    await store.init();
    for (let n = 1; n <= 130; n++) store.put('quotes', { number: n, title: n === 7 ? 'Mowing' : 'Hedge trim' });
    const search = createSearchIndex(store);
    const first = (q) => search(q).find((g) => g.coll === 'quotes')?.items[0].title;
    expect(first('12')).toBe('Quote #12: Hedge trim');
    expect(first('#12')).toBe('Quote #12: Hedge trim');
    expect(first('quote 12')).toBe('Quote #12: Hedge trim');
    expect(first('mow')).toBe('Quote #7: Mowing');
  });
});
