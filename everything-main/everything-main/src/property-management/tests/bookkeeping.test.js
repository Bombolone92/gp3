import { describe, it, expect } from 'vitest';
import { ACC } from '../src/core/accounts.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { startBookkeeping } from '../src/bookkeeping.js';

const lease = { id: 'L1', propertyId: 'P1', unitId: 'U1', type: 'fixed', start: '2026-10-01', end: '2027-09-30', recurring: [{ id: 'r', accountId: ACC.rent, amount: 100000, day: 1, start: '2026-10-01', postedThrough: null }], lateFee: { enabled: false } };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('automatic posting', () => {
  it('posts as soon as it is turned back on, not the next day', async () => {
    const store = createStore({ backend: createMemoryBackend({ collections: { leases: [lease] } }), flushDelay: 0, timeoutMs: 0 });
    await store.init();
    store.saveSettings({ accounting: { autoPost: false } });
    const posted = [];
    const stop = startBookkeeping(store, { today: () => '2026-10-12', onPosted: (n) => posted.push(n) });
    try {
      await tick();
      expect(store.all('transactions').filter((t) => t.kind === 'charge')).toHaveLength(0);
      store.saveSettings({ accounting: { autoPost: true } });
      await tick();
      expect(store.all('transactions').filter((t) => t.kind === 'charge').map((t) => t.date)).toEqual(['2026-10-01']);
      expect(posted).toEqual([1]);
    } finally {
      stop();
    }
  });
});
