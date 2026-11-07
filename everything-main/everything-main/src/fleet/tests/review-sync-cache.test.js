/**
 * The IndexedDB snapshot cache.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import * as cacheModule from '../src/core/cache.js';

const { createIdbCache } = cacheModule;

describe('snapshot cache', () => {
  it('removes every fleet a person had on this device when they sign out', async () => {
    const own = createIdbCache('user:u-1');
    const joined = createIdbCache('user:u-1:team:https://fleet-abc.puter.work');
    const someoneElse = createIdbCache('user:u-2');
    await own.save({ v: 1, collections: { vehicles: [{ id: 'v1' }] } });
    await joined.save({ v: 1, collections: { vehicles: [{ id: 'v2' }] } });
    await someoneElse.save({ v: 1, collections: { vehicles: [{ id: 'v3' }] } });
    expect(typeof cacheModule.clearUserCaches).toBe('function');
    await cacheModule.clearUserCaches('u-1');
    expect(await own.load()).toBeUndefined();
    expect(await joined.load()).toBeUndefined();
    expect((await someoneElse.load()).collections.vehicles[0].id).toBe('v3');
  });

  it('stops writing the cache once signing out has removed it', async () => {
    const saved = [];
    const cache = { load: async () => null, save: async (s) => void saved.push(s) };
    const store = createStore({ backend: createMemoryBackend(), cache, flushDelay: 1e9 });
    await store.init();
    store.put('vehicles', { name: 'Van' });
    store.detachCache();
    // The page hides as it reloads after signing out.
    await store.persistCache();
    await new Promise((r) => setTimeout(r, 700));
    expect(saved).toHaveLength(0);
  });
});
