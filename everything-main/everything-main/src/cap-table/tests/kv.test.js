import { beforeEach, describe, expect, it } from 'vitest';
import { readKV, getKV, compareAndSetKV, deleteKV, KVConflictError, KVReadError } from '../src/lib/kv.js';
import { puterBackend, deferred } from './helpers/puter-kv.js';

describe('conditional KV publication', () => {
  let backend;
  beforeEach(() => {
    backend = puterBackend();
    backend.install();
  });
  const write = async (key, raw) => compareAndSetKV(key, await readKV(key), raw);

  it.each([null, '[{"name":"Legacy"}]', { company: 'Legacy' }])('reads and upgrades legacy %j without losing the value', async (raw) => {
    if (raw !== null) backend.values.set('data', raw);
    expect(await getKV('data')).toEqual(raw);
    await write('data', 'updated');
    expect(await getKV('data')).toBe('updated');
    expect(backend.calls.some((call) => call.method === 'add')).toBe(true);
  });

  it('accepts exactly one of simultaneous writes against the same revision', async () => {
    await write('data', 'before');
    const expected = await readKV('data');
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      compareAndSetKV('data', expected, `writer ${i}`)));
    const winner = results.findIndex((r) => r.status === 'fulfilled');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason instanceof KVConflictError)).toBe(true);
    expect(await getKV('data')).toBe(`writer ${winner}`);
  });

  it('refuses an old revision even if its bytes have since come back', async () => {
    const old = await write('data', 'A');
    await write('data', 'B');
    await write('data', 'A');
    await expect(compareAndSetKV('data', old, 'stale')).rejects.toBeInstanceOf(KVConflictError);
    expect(await getKV('data')).toBe('A');
  });

  it('follows a delayed shortcut backwards through completed newer writes', async () => {
    await write('data', 'base');
    const started = deferred();
    const release = deferred();
    const set = puter.kv.set;
    let pause = true;
    puter.kv.set = async (key, value) => {
      if (key === 'data' && pause) {
        pause = false;
        started.resolve();
        await release.promise;
      }
      return set(key, value);
    };
    const first = write('data', 'first');
    await started.promise;
    expect(await getKV('data')).toBe('first');
    await write('data', 'second');
    await write('data', 'third');
    release.resolve();
    await first;
    expect(await getKV('data')).toBe('third');
  });

  it('keeps reading confirmed writes when shortcut updates fail', async () => {
    const set = puter.kv.set;
    puter.kv.set = async (key, value) => {
      if (key === 'data') throw new Error('lost shortcut');
      return set(key, value);
    };
    for (let i = 0; i < 30; i++) await write('data', `value ${i}`);
    expect(await getKV('data')).toBe('value 29');
  });

  it('does not publish a failed payload or require a crashed writer to release a lock', async () => {
    await write('data', 'base');
    const set = puter.kv.set;
    puter.kv.set = async () => { throw new Error('offline'); };
    await expect(write('data', 'failed')).rejects.toThrow('offline');
    puter.kv.set = set;
    expect(await getKV('data')).toBe('base');
    await write('data', 'retry');
    expect(await getKV('data')).toBe('retry');
  });

  it.each([false, true])('removes a payload whose upload failed (landed=%s) and marks the failure unsent', async (landed) => {
    await write('data', 'base');
    const set = puter.kv.set;
    puter.kv.set = async (...args) => {
      if (landed) await set(...args);
      throw new Error('offline');
    };
    const failure = await write('data', 'failed').catch((err) => err);
    puter.kv.set = set;
    expect(failure.message).toBe('offline');
    // Nothing was appended, so the caller can tell this from a lost acknowledgement.
    expect(failure.unsent).toBe(true);
    // The upload that landed with its acknowledgement lost is unreachable and is gone.
    expect([...backend.values.keys()].filter((k) => k.endsWith(':value'))).toHaveLength(1);
    expect(await getKV('data')).toBe('base');
  });

  it.each([false, true])('handles an append failure (landed=%s) and allows a subsequent write', async (landed) => {
    await write('data', 'base');
    const add = puter.kv.add;
    puter.kv.add = async (...args) => {
      if (landed) await add(...args);
      throw new Error('lost acknowledgement');
    };
    await expect(write('data', 'attempted')).rejects.toThrow('lost acknowledgement');
    puter.kv.add = add;
    expect(await getKV('data')).toBe(landed ? 'attempted' : 'base');
    await write('data', 'retry');
    expect(await getKV('data')).toBe('retry');
  });

  it('cannot resurrect a deletion with a delayed earlier writer', async () => {
    const old = await write('data', 'base');
    await deleteKV('data');
    expect(await getKV('data')).toBeNull();
    await expect(compareAndSetKV('data', old, 'resurrected')).rejects.toBeInstanceOf(KVConflictError);
    await write('data', 'recreated');
    expect(await getKV('data')).toBe('recreated');
  });

  it('leaves a key that holds nothing alone when asked to delete it', async () => {
    expect(await deleteKV('never')).toBeNull();
    expect(backend.values.size).toBe(0);
    await write('data', 'base');
    expect(await deleteKV('data')).toBe('base');
    backend.calls.length = 0;
    expect(await deleteKV('data')).toBeNull();
    expect(backend.calls.every((call) => call.method === 'get')).toBe(true);
    expect(await getKV('data')).toBeNull();
  });

  it('removes a value that slipped in ahead of the delete, and hands back what it removed', async () => {
    await write('data', 'base');
    const add = puter.kv.add;
    let once = true;
    puter.kv.add = async (key, items) => {
      if (once) {
        once = false;
        await write('data', 'slipped in');
      }
      return add(key, items);
    };
    expect(await deleteKV('data')).toBe('slipped in');
    expect(await getKV('data')).toBeNull();
    await expect(compareAndSetKV('data', { revision: 'initial' }, 'late')).rejects.toBeInstanceOf(KVConflictError);
  });

  it('retries when a newer publication removes a payload a reader was about to fetch', async () => {
    await write('data', 'base');
    const get = puter.kv.get;
    let pause = true;
    puter.kv.get = async (key) => {
      if (key.endsWith(':value') && pause) {
        pause = false;
        await write('data', 'newer');
      }
      return get(key);
    };
    expect(await getKV('data')).toBe('newer');
  });

  it('reports missing payloads as corruption rather than an empty collection', async () => {
    await write('data', 'base');
    for (const key of backend.values.keys()) if (key.endsWith(':value')) backend.values.delete(key);
    await expect(getKV('data')).rejects.toBeInstanceOf(KVReadError);
  });

  it('bounds payload storage across repeated writes while keeping successor links', async () => {
    for (let i = 0; i < 100; i++) await write('data', 'x'.repeat(380_000));
    expect([...backend.values.keys()].filter((key) => key.endsWith(':value'))).toHaveLength(1);
    expect((await getKV('data')).length).toBe(380_000);
  });

  it('starts the next read at the head it last saw, and still follows a write made elsewhere', async () => {
    await write('data', 'mine');
    const { revision: mine } = await readKV('data');
    backend.calls.length = 0;
    expect(await getKV('data')).toBe('mine');
    // One hop: the head's successor link and payload, no shortcut lookup.
    expect(backend.calls.map((call) => call.key)).toEqual([`data:revision:${mine}:next`, `data:revision:${mine}:value`]);
    // Another device publishes a successor and cleans up. Only its links and payload say so.
    const theirs = crypto.randomUUID();
    backend.values.set(`data:revision:${theirs}:value`, 'theirs');
    backend.values.set(`data:revision:${mine}:next`, [{ __captableRevision: theirs }]);
    backend.values.delete(`data:revision:${mine}:value`);
    expect(await getKV('data')).toBe('theirs');
    await expect(compareAndSetKV('data', { revision: mine }, 'late')).rejects.toBeInstanceOf(KVConflictError);
    expect(await getKV('data')).toBe('theirs');
  });

  it('falls back to the shortcut when the remembered head belongs to another store', async () => {
    await write('data', 'first account');
    backend = puterBackend();
    backend.install();
    backend.values.set('data', 'legacy');
    expect(await getKV('data')).toBe('legacy');
    await write('data', 'second account');
    expect(await getKV('data')).toBe('second account');
    // A deletion is remembered by nothing: a tombstone has no payload to
    // confirm it, so it must not seed a chain in the next store.
    await deleteKV('data');
    backend = puterBackend();
    backend.install();
    expect(await readKV('data')).toEqual({ raw: null, revision: 'initial' });
    await write('data', 'third account');
    await expect(compareAndSetKV('data', { revision: 'initial' }, 'late')).rejects.toBeInstanceOf(KVConflictError);
    expect(await getKV('data')).toBe('third account');
  });

  it('spends four round trips on a save that follows a read', async () => {
    await write('data', 'before');
    backend.calls.length = 0;
    await write('data', 'after');
    const methods = backend.calls.map((call) => call.method);
    expect(methods).toEqual(['get', 'get', 'set', 'add', 'set', 'del']);
    expect(await getKV('data')).toBe('after');
  });

  it('fails closed when the SDK has no atomic append', async () => {
    delete puter.kv.add;
    await expect(write('data', 'unsafe')).rejects.toThrow('safe concurrent saves');
    expect(backend.values.size).toBe(0);
  });
});
