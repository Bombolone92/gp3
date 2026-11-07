import { describe, it, expect } from 'vitest';
import { mirror, looksOffline, mirrorDocKey, MIRROR_META } from '../src/lib/mirror.js';

describe('looksOffline', () => {
  it('recognises the shapes a lost connection takes', () => {
    expect(looksOffline(new TypeError('Failed to fetch'))).toBe(true);
    expect(looksOffline(new Error('Load failed'))).toBe(true);
    expect(looksOffline(new Error('network error'))).toBe(true);
    expect(looksOffline({ message: 'connection timeout' })).toBe(true);
  });

  it('does not mistake an answer from the server for silence', () => {
    // These are real answers: retrying them forever would be wrong.
    expect(looksOffline({ code: 'subject_does_not_exist' })).toBe(false);
    expect(looksOffline({ code: 'forbidden', message: 'network' })).toBe(false);
    expect(looksOffline(new Error('invalid json'))).toBe(false);
    expect(looksOffline(null)).toBe(false);
  });
});

describe('mirror', () => {
  it('degrades to nothing when IndexedDB is unavailable', async () => {
    // Node has no IndexedDB, which is also the private-mode case.
    expect(mirror.available()).toBe(false);
    await expect(mirror.set('k', { a: 1 })).resolves.toBeNull();
    await expect(mirror.get('k')).resolves.toBeNull();
    await expect(mirror.keys()).resolves.toEqual([]);
    await expect(mirror.del('k')).resolves.toBeNull();
  });

  it('names its keys in one place', () => {
    expect(mirrorDocKey('abc')).toBe('doc:abc');
    expect(MIRROR_META).toBe('meta:v1');
  });
});
