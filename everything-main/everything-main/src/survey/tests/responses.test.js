import { describe, it, expect } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createResponseStore } from '../src/data/responses.js';

const key = (t, r = 'aaaa') => `${t.toString(36).padStart(9, '0')}${r}`;

/** A fake collector client over a list of responses, newest first, whose
 *  page reads can be held open to interleave other calls. */
function fakeClient(items) {
  const data = items.slice();
  let gate = null;
  return {
    data,
    hold() {
      let release;
      gate = new Promise((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    async responsesPage(sid, { limit, cursor }) {
      const start = cursor ? Number(cursor) : 0;
      const sorted = data.slice().sort((a, b) => (a.key < b.key ? 1 : -1));
      const page = sorted.slice(start, start + limit);
      if (gate) await gate;
      return { items: page.map((it) => ({ key: it.key, value: it.value })), cursor: start + limit < sorted.length ? String(start + limit) : null };
    },
    async deleteResponses(sid, keys) {
      for (const k of keys) {
        const i = data.findIndex((it) => it.key === k);
        if (i >= 0) data.splice(i, 1);
      }
      return { deleted: keys.length };
    },
  };
}

describe('response store', () => {
  it('does not bring back a response deleted while a sync was in flight', async () => {
    const t = 1_800_000_000_000;
    const k1 = key(t);
    const k2 = key(t + 1000);
    const client = fakeClient([
      { key: k1, value: { at: t, answers: {} } },
      { key: k2, value: { at: t + 1000, answers: {} } },
    ]);
    const store = createResponseStore({ client, idb: new IDBFactory() });
    expect((await store.sync('s1')).map((r) => r.key)).toEqual([k1, k2]);

    const release = client.hold();
    const pending = store.sync('s1', { expectedCount: 2 });
    const afterDelete = await store.remove('s1', [k1]);
    expect(afterDelete.map((r) => r.key)).toEqual([k2]);
    release();
    expect((await pending).map((r) => r.key)).toEqual([k2]);

    // Later syncs and the cache agree.
    expect((await store.sync('s1', { expectedCount: 1 })).map((r) => r.key)).toEqual([k2]);
    expect((await store.cached('s1')).map((r) => r.key)).toEqual([k2]);
  });
});

describe('response store clear', () => {
  it('removes every cached survey', async () => {
    const t = 1_800_000_000_000;
    const client = fakeClient([{ key: key(t), value: { at: t, answers: {} } }]);
    const idb = new IDBFactory();
    const store = createResponseStore({ client, idb });
    await store.sync('s1');
    await store.clear();
    const fresh = createResponseStore({ client, idb });
    expect(await fresh.cached('s1')).toEqual([]);
  });
});

describe('response store clear, with other tabs and syncs', () => {
  it('is not blocked by another tab, which keeps working after', async () => {
    const t = 1_800_000_000_000;
    const client = fakeClient([{ key: key(t), value: { at: t, answers: {} } }]);
    const idb = new IDBFactory();
    const other = createResponseStore({ client, idb });
    await other.sync('s1');
    await createResponseStore({ client, idb }).clear();
    const fresh = createResponseStore({ client, idb });
    expect(await fresh.cached('s1')).toEqual([]);
    const done = await Promise.race([fresh.sync('s1').then(() => 'synced'), new Promise((r) => setTimeout(() => r('stuck'), 1000))]);
    expect(done).toBe('synced');
    expect((await other.sync('s1')).length).toBe(1);
  });

  it('waits for a sync under way, so nothing is written back', async () => {
    const t = 1_800_000_000_000;
    const client = fakeClient([{ key: key(t), value: { at: t, answers: {} } }]);
    const idb = new IDBFactory();
    const store = createResponseStore({ client, idb });
    const release = client.hold();
    const pending = store.sync('s1');
    const cleared = store.clear();
    release();
    await pending;
    await cleared;
    expect(await createResponseStore({ client, idb }).cached('s1')).toEqual([]);
  });

  it('keeps nothing on the device from a tab told another signed out', async () => {
    const t = 1_800_000_000_000;
    const client = fakeClient([{ key: key(t), value: { at: t, answers: { q: 'secret' } } }]);
    const idb = new IDBFactory();
    const other = createResponseStore({ client, idb });
    await other.sync('s1');
    other.stop();
    await createResponseStore({ client, idb }).clear();
    // Its next poll still works, from memory only.
    expect((await other.sync('s1')).length).toBe(1);
    expect(await createResponseStore({ client, idb }).cached('s1')).toEqual([]);
  });
});

describe('response store polling cost', () => {
  it('asks for a small first page when only new responses are needed', async () => {
    const t = 1_800_000_000_000;
    const items = Array.from({ length: 600 }, (_, i) => ({ key: key(t + i * 3_600_000), value: { at: t + i * 3_600_000, answers: {} } }));
    const client = fakeClient(items);
    const limits = [];
    const page = client.responsesPage.bind(client);
    client.responsesPage = (sid, opts) => (limits.push(opts.limit), page(sid, opts));
    const store = createResponseStore({ client, idb: new IDBFactory() });
    expect(await store.sync('s1')).toHaveLength(600);
    limits.length = 0;
    expect(await store.sync('s1')).toHaveLength(600);
    expect(limits).toEqual([25]);
  });
});

describe('response store cache writes', () => {
  it('does not rewrite the cache when a sync finds nothing new', async () => {
    const t = 1_800_000_000_000;
    const client = fakeClient([{ key: key(t), value: { at: t, answers: {} } }]);
    const store = createResponseStore({ client, idb: new IDBFactory() });
    await store.sync('s1');
    const put = IDBObjectStore.prototype.put;
    let puts = 0;
    IDBObjectStore.prototype.put = function (...a) {
      puts++;
      return put.apply(this, a);
    };
    try {
      expect(await store.sync('s1')).toHaveLength(1);
      expect(puts).toBe(0);
      client.data.push({ key: key(t + 1000), value: { at: t + 1000, answers: {} } });
      expect(await store.sync('s1')).toHaveLength(2);
      expect(puts).toBe(1);
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  });
});

describe('response store count check', () => {
  it('does not re-read everything because a response arrived mid-sync', async () => {
    const t = 1_800_000_000_000;
    const items = Array.from({ length: 50 }, (_, i) => ({ key: key(t + i * 3_600_000), value: { at: t + i * 3_600_000, answers: {} } }));
    const client = fakeClient(items);
    const idb = new IDBFactory();
    await createResponseStore({ client, idb, pageSize: 10 }).sync('s1');
    // A later session, with the cache filled.
    const store = createResponseStore({ client, idb, pageSize: 10 });
    let pages = 0;
    const page = client.responsesPage.bind(client);
    client.responsesPage = (sid, opts) => (pages++, page(sid, opts));
    // A response lands after the list was read, before the count is.
    let counted = false;
    const count = async () => {
      if (!counted) {
        counted = true;
        client.data.push({ key: key(t + 60 * 3_600_000), value: { at: t + 60 * 3_600_000, answers: {} } });
      }
      return client.data.length;
    };
    expect(await store.sync('s1', { expectedCount: count })).toHaveLength(51);
    expect(pages).toBe(2); // two catch-up pages, not a full read of 6
  });

  it('still re-reads everything when the count keeps disagreeing', async () => {
    const t = 1_800_000_000_000;
    const client = fakeClient([{ key: key(t), value: { at: t, answers: {} } }, { key: key(t + 1), value: { at: t + 1, answers: {} } }]);
    const idb = new IDBFactory();
    await createResponseStore({ client, idb }).sync('s1');
    const store = createResponseStore({ client, idb });
    // Deleted on another device: only a full read finds out.
    client.data.splice(0, 1);
    expect(await store.sync('s1', { expectedCount: async () => 1 })).toHaveLength(1);
  });
});

