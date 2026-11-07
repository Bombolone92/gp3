/**
 * Storage adapters. The store persists each collection as a JSON document
 * under a namespaced key. Two adapters share the same interface:
 *
 *   load(collection)        -> Promise<any | null>
 *   save(collection, data)  -> Promise<void>
 *   remove(collection)      -> Promise<void>
 *
 * `createPuterBackend` is backed by the Puter.js cloud key-value store
 * (https://docs.puter.com) and is used in production. `createMemoryBackend`
 * is used for tests.
 */

const NS = 'shifts.v1';

export function createPuterBackend(puterInstance) {
  const kv = () => {
    const p = puterInstance ?? globalThis.puter;
    if (!p?.kv) throw new Error('Puter.js is not available');
    return p.kv;
  };

  return {
    async load(collection) {
      const raw = await kv().get(`${NS}:${collection}`);
      if (raw === null || raw === undefined) return null;
      try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        return null;
      }
    },
    async save(collection, data) {
      await kv().set(`${NS}:${collection}`, JSON.stringify(data));
    },
    async remove(collection) {
      await kv().del(`${NS}:${collection}`);
    },
  };
}

/**
 * Wraps a backend with the offline mirror and write queue:
 * - load() serves the network when it can, refreshing the mirror, and
 *   falls back to the cached copy on transport failures. A collection
 *   with a queued (dirty) write is served from the mirror instead, so
 *   a reload never replaces unsynced local changes with the server copy.
 * - save() always updates the mirror; a save that fails for network
 *   reasons is queued (marked dirty) and succeeds from the caller's
 *   point of view. Real API errors still throw, and so does a network
 *   failure the mirror couldn't absorb (there would be nothing to
 *   replay, so reporting success would lose the write silently).
 * - flushPending() replays queued collections from the mirror,
 *   last-writer-wins per collection.
 */
export function createOfflineBackend(inner, offlineStore, isNetworkError) {
  // Whole-document requests must finish in order for each collection.
  // Otherwise an older save (including a reconnect flush) can arrive
  // last and silently replace a newer edit. Different collections can
  // still use the network concurrently, and a rejection releases the queue.
  const pending = new Map();
  function serial(collection, operation) {
    const result = (pending.get(collection) ?? Promise.resolve()).then(operation);
    const settled = result.catch(() => {});
    pending.set(collection, settled);
    settled.then(() => {
      if (pending.get(collection) === settled) pending.delete(collection);
    });
    return result;
  }

  return {
    async load(collection) {
      return serial(collection, async () => {
        // A queued write is newer than whatever the server holds: loading it
        // over the mirror here would discard the change before flushPending()
        // gets a chance to replay it (the store loads before the first flush).
        if (offlineStore.dirtyList().includes(collection)) {
          const cached = offlineStore.getKV(collection);
          if (cached !== undefined) return cached === null ? null : JSON.parse(cached);
        }
        try {
          const value = await inner.load(collection);
          offlineStore.setKV(collection, value === null ? null : JSON.stringify(value));
          return value;
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          const cached = offlineStore.getKV(collection);
          if (cached === undefined) throw err; // nothing local: fail loudly
          return cached === null ? null : JSON.parse(cached);
        }
      });
    },

    async save(collection, data) {
      // Capture the value at call time: store actions may mutate it
      // again while this request waits for an earlier one to finish.
      const raw = JSON.stringify(data);
      return serial(collection, async () => {
        const mirrored = offlineStore.setKV(collection, raw);
        try {
          await inner.save(collection, JSON.parse(raw));
          offlineStore.clearDirty(collection);
        } catch (err) {
          // Queueing a write only works when the mirror holds the new value:
          // it is what flushPending() replays. Without it (storage blocked or
          // full, or no per-user namespace yet) there is nothing to replay, so
          // report the failure instead of telling the caller it was saved.
          if (!isNetworkError(err) || !mirrored) throw err;
          // The mirror alone is not enough: reloads and reconnects must
          // also know this collection still needs to reach the server.
          if (!offlineStore.markDirty(collection)) throw err;
        }
      });
    },

    async remove(collection) {
      return serial(collection, async () => {
        offlineStore.setKV(collection, null);
        await inner.remove(collection);
      });
    },

    pendingWrites() {
      return offlineStore.pendingCount();
    },

    async flushPending() {
      let flushed = 0;
      for (const collection of offlineStore.dirtyList()) {
        flushed += await serial(collection, async () => {
          // An earlier save/flush may have synced it while we waited.
          if (!offlineStore.dirtyList().includes(collection)) return 0;
          const raw = offlineStore.getKV(collection);
          if (raw === undefined || raw === null) {
            offlineStore.clearDirty(collection);
            return 0;
          }
          await inner.save(collection, JSON.parse(raw));
          offlineStore.clearDirty(collection);
          return 1;
        });
      }
      return flushed;
    },
  };
}

export function createMemoryBackend(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    async load(collection) {
      return data.has(collection) ? structuredClone(data.get(collection)) : null;
    },
    async save(collection, value) {
      data.set(collection, structuredClone(value));
    },
    async remove(collection) {
      data.delete(collection);
    },
    /** Test helper: inspect raw stored value. */
    peek(collection) {
      return data.get(collection) ?? null;
    },
  };
}
