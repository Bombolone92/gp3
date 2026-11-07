/**
 * The in-memory KV is the ground the worker tests stand on, so its
 * path semantics are pinned here against the documented behavior of
 * puter.kv.add / update / remove / incr.
 */
import { describe, it, expect } from 'vitest';
import { createMemoryKv } from '../dev/worker-runtime.js';

describe('memory kv', () => {
  it('set/get round-trips without aliasing', async () => {
    const kv = createMemoryKv();
    const v = { a: [1] };
    await kv.set('k', v);
    v.a.push(2);
    expect(await kv.get('k')).toEqual({ a: [1] });
    expect(await kv.get('missing')).toBeNull();
  });

  it('incr initializes missing counters and supports nested paths', async () => {
    const kv = createMemoryKv();
    expect(await kv.incr('n')).toBe(1);
    expect(await kv.incr('n', 5)).toBe(6);
    await kv.set('stats', { user: { score: 10 } });
    expect(await kv.incr('stats', { 'user.score': 2 })).toEqual({ user: { score: 12 } });
    expect(await kv.incr('stats', { 'user.other': -1 })).toEqual({ user: { score: 12, other: -1 } });
  });

  it('add appends array elements at a path', async () => {
    const kv = createMemoryKv();
    await kv.set('profile', { tags: ['alpha'] });
    expect(await kv.add('profile', { tags: ['beta', 'gamma'] })).toEqual({ tags: ['alpha', 'beta', 'gamma'] });
    expect(await kv.add('profile', { tags: [{ s: 1 }] })).toEqual({ tags: ['alpha', 'beta', 'gamma', { s: 1 }] });
  });

  it('strict mode refuses add on a missing key', async () => {
    const kv = createMemoryKv({ strictAdd: true });
    await expect(kv.add('nope', { m: [1] })).rejects.toThrow();
    const lax = createMemoryKv();
    expect(await lax.add('nope', { m: [1] })).toEqual({ m: [1] });
  });

  it('update sets nested paths and creates intermediates as objects', async () => {
    const kv = createMemoryKv();
    await kv.set('doc', { x: {} });
    await kv.update('doc', { 'x.s12.t': 'hi', 'x.s12.e': 5, name: 'n' });
    expect(await kv.get('doc')).toEqual({ x: { s12: { t: 'hi', e: 5 } }, name: 'n' });
    expect(Array.isArray((await kv.get('doc')).x)).toBe(false);
  });

  it('remove deletes nested paths', async () => {
    const kv = createMemoryKv();
    await kv.set('doc', { r: { heart: { a: 1, b: 1 } } });
    await kv.remove('doc', 'r.heart.a');
    expect(await kv.get('doc')).toEqual({ r: { heart: { b: 1 } } });
    await kv.remove('doc', 'r.heart');
    expect(await kv.get('doc')).toEqual({ r: {} });
  });

  it('expires keys after their ttl, keeps the ttl through incr, drops it on set', async () => {
    const kv = createMemoryKv();
    await kv.set('a', 1);
    await kv.expire('a', 60);
    expect(await kv.get('a')).toBe(1);
    await kv.incr('a');
    expect(kv._ttl.get('a')).toBe(60);
    await kv.expire('a', -1);
    expect(await kv.get('a')).toBeNull();
    await kv.set('b', 'x');
    await kv.expire('b', -1);
    await kv.set('b', 'y'); // a fresh value has no expiry
    expect(await kv.get('b')).toBe('y');
    expect(await kv.get('b')).toBe('y');
  });

  it('rejects values over 400 KB like the real store', async () => {
    const kv = createMemoryKv();
    await expect(kv.set('big', 'x'.repeat(401 * 1024))).rejects.toThrow();
  });
});
