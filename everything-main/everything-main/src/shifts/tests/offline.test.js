import { describe, it, expect, beforeEach } from 'vitest';
import { offline, isNetworkError } from '../src/core/offline.js';
import { createOfflineBackend, createMemoryBackend } from '../src/core/backend.js';

/** Minimal localStorage for the node test environment. */
function fakeLocalStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** A backend whose network can be switched off. */
function flakyBackend() {
  const inner = createMemoryBackend();
  const state = { online: true, saves: 0 };
  return {
    state,
    inner,
    async load(c) {
      if (!state.online) throw new TypeError('Failed to fetch');
      return inner.load(c);
    },
    async save(c, d) {
      if (!state.online) throw new TypeError('Failed to fetch');
      state.saves += 1;
      return inner.save(c, d);
    },
    async remove(c) {
      return inner.remove(c);
    },
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
  offline.setUser({ uuid: 'u1', username: 'ava' });
});

describe('offline mirror', () => {
  it('is namespaced per user and cleared on mismatch', () => {
    offline.setKV('employees', '[1]');
    expect(offline.getKV('employees')).toBe('[1]');
    expect(offline.matches({ uuid: 'u1' })).toBe(true);
    expect(offline.matches({ uuid: 'other' })).toBe(false);

    offline.clearAll();
    expect(offline.hasCache()).toBe(false);
    expect(offline.getKV('employees')).toBeUndefined();
  });

  it('distinguishes known-missing from cache miss', () => {
    expect(offline.getKV('shifts')).toBeUndefined();
    offline.setKV('shifts', null);
    expect(offline.getKV('shifts')).toBeNull();
  });

  it('tracks a deduplicated dirty set', () => {
    offline.markDirty('shifts');
    offline.markDirty('shifts');
    offline.markDirty('employees');
    expect(offline.dirtyList()).toEqual(['shifts', 'employees']);
    offline.clearDirty('shifts');
    expect(offline.pendingCount()).toBe(1);
  });
});

describe('createOfflineBackend', () => {
  let net;
  let backend;

  beforeEach(() => {
    net = flakyBackend();
    backend = createOfflineBackend(net, offline, isNetworkError);
  });

  it('refreshes the mirror on successful loads and serves it offline', async () => {
    await net.inner.save('employees', [{ id: 'e1' }]);
    expect(await backend.load('employees')).toEqual([{ id: 'e1' }]);

    net.state.online = false;
    expect(await backend.load('employees')).toEqual([{ id: 'e1' }]);
  });

  it('fails loudly offline when nothing is cached', async () => {
    net.state.online = false;
    await expect(backend.load('swaps')).rejects.toThrow(/failed to fetch/i);
  });

  it('queues offline saves and replays them on flush', async () => {
    net.state.online = false;
    await backend.save('shifts', [{ id: 's1' }]); // resolves: queued locally
    expect(backend.pendingWrites()).toBe(1);
    expect(await backend.load('shifts')).toEqual([{ id: 's1' }]); // reads own write

    net.state.online = true;
    expect(await backend.flushPending()).toBe(1);
    expect(backend.pendingWrites()).toBe(0);
    expect(net.inner.peek('shifts')).toEqual([{ id: 's1' }]);
  });

  it('serves a queued write on load instead of clobbering it with the server copy', async () => {
    await net.inner.save('shifts', [{ id: 'server' }]);
    net.state.online = false;
    await backend.save('shifts', [{ id: 'local' }]); // queued

    // Back online before the queue is flushed (e.g. the app reloads):
    // the queued write is newer than the server copy and must survive.
    net.state.online = true;
    expect(await backend.load('shifts')).toEqual([{ id: 'local' }]);
    expect(backend.pendingWrites()).toBe(1);

    expect(await backend.flushPending()).toBe(1);
    expect(net.inner.peek('shifts')).toEqual([{ id: 'local' }]);
    expect(await backend.load('shifts')).toEqual([{ id: 'local' }]);
  });

  it('clears the queue entry once an online save succeeds', async () => {
    net.state.online = false;
    await backend.save('shifts', [1]);
    net.state.online = true;
    await backend.save('shifts', [1, 2]);
    expect(backend.pendingWrites()).toBe(0);
    expect(net.inner.peek('shifts')).toEqual([1, 2]);
  });

  it('reports a network failure the mirror could not absorb', async () => {
    // No namespace to write into (the profile fetch failed, or storage is
    // blocked): there would be nothing for flushPending to replay, so the
    // caller must not be told the write landed.
    offline.clearAll();
    net.state.online = false;
    await expect(backend.save('shifts', [{ id: 's1' }])).rejects.toThrow(/failed to fetch/i);
    expect(backend.pendingWrites()).toBe(0);
  });

  it('reports a network failure when storage cannot track the queued write', async () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = (key, value) => {
      if (key.endsWith(':dirty')) throw new Error('Storage quota exceeded');
      setItem(key, value);
    };
    net.state.online = false;
    await expect(backend.save('shifts', [1])).rejects.toThrow(/failed to fetch/i);
    expect(backend.pendingWrites()).toBe(0);
  });

  it('can update an already queued collection when no queue write is needed', async () => {
    net.state.online = false;
    await backend.save('shifts', [1]);
    const setItem = localStorage.setItem;
    localStorage.setItem = (key, value) => {
      if (key.endsWith(':dirty')) throw new Error('Storage quota exceeded');
      setItem(key, value);
    };
    await backend.save('shifts', [1, 2]);
    expect(backend.pendingWrites()).toBe(1);
    expect(await backend.load('shifts')).toEqual([1, 2]);
  });

  it('rethrows real API errors instead of queueing', async () => {
    const broken = {
      load: async () => null,
      save: async () => {
        throw new Error('KV key too large');
      },
      remove: async () => {},
    };
    const wrapped = createOfflineBackend(broken, offline, isNetworkError);
    await expect(wrapped.save('shifts', [1])).rejects.toThrow(/too large/);
    expect(wrapped.pendingWrites()).toBe(0);
  });

  it('keeps the latest save when an earlier request takes longer', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const wrapped = createOfflineBackend({
      ...net,
      async save(collection, data) {
        if (++calls === 1) await gate;
        await net.inner.save(collection, data);
      },
    }, offline, isNetworkError);
    const first = wrapped.save('shifts', [1]);
    const latest = [1, 2];
    const second = wrapped.save('shifts', latest);
    latest.push(3); // A later in-memory edit is not part of this save.
    await new Promise(setImmediate);
    release();
    await Promise.all([first, second]);
    expect(net.inner.peek('shifts')).toEqual([1, 2]);
    expect(offline.getKV('shifts')).toBe('[1,2]');
  });

  it('does not let an in-flight flush overwrite a newer edit', async () => {
    offline.setKV('shifts', '[1]');
    offline.markDirty('shifts');
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const wrapped = createOfflineBackend({
      ...net,
      async save(collection, data) {
        if (++calls === 1) await gate;
        await net.inner.save(collection, data);
      },
    }, offline, isNetworkError);
    const flush = wrapped.flushPending();
    await new Promise(setImmediate);
    const edit = wrapped.save('shifts', [1, 2]);
    await new Promise(setImmediate);
    release();
    await Promise.all([flush, edit]);
    expect(net.inner.peek('shifts')).toEqual([1, 2]);
    expect(await wrapped.load('shifts')).toEqual([1, 2]);
    expect(wrapped.pendingWrites()).toBe(0);
  });

  it('continues saving after a rejected request', async () => {
    let calls = 0;
    const wrapped = createOfflineBackend({
      ...net,
      async save(collection, data) {
        if (++calls === 1) throw new Error('Permission denied');
        await net.inner.save(collection, data);
      },
    }, offline, isNetworkError);
    const rejected = expect(wrapped.save('shifts', [1])).rejects.toThrow('Permission denied');
    const saved = wrapped.save('shifts', [1, 2]);
    await Promise.all([rejected, saved]);
    expect(net.inner.peek('shifts')).toEqual([1, 2]);
  });

  it('lets independent collections save while another request is pending', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const wrapped = createOfflineBackend({
      ...net,
      async save(collection, data) {
        if (collection === 'shifts') await gate;
        await net.inner.save(collection, data);
      },
    }, offline, isNetworkError);
    const slow = wrapped.save('shifts', [1]);
    try {
      await wrapped.save('employees', [2]);
      expect(net.inner.peek('employees')).toEqual([2]);
      expect(net.inner.peek('shifts')).toBeNull();
    } finally {
      release();
      await slow;
    }
  });
});

describe('isNetworkError', () => {
  it('recognizes transport failures but not API errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new Error('Network request timed out'))).toBe(true);
    expect(isNetworkError(new Error('Permission denied'))).toBe(false);
  });
});
