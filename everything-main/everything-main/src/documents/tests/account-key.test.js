import { afterEach, describe, expect, it } from 'vitest';
import { accountKey } from '../src/lib/account-key.js';
import { session } from '../src/lib/session.js';
import { starredPaths, toggleStar, pruneStars } from '../src/lib/starred.js';
import { recallGoal, rememberGoal } from '../src/lib/goal.js';
import { recallPosition, rememberPosition } from '../src/lib/position.js';

const memory = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const storage = memory();
globalThis.localStorage = storage;
afterEach(() => { session.user = null; storage.m.clear(); });

describe('settings kept per account', () => {
  it('uses the plain key for nobody and a key of the account\'s own once signed in, inheriting the device\'s once', () => {
    expect(accountKey('documents:x', storage)).toBe('documents:x');
    storage.setItem('documents:x', '["kept"]');
    session.user = { username: 'ann', uuid: 'u-ann' };
    expect(accountKey('documents:x', storage)).toBe('documents:x:u-ann');
    expect(storage.getItem('documents:x:u-ann')).toBe('["kept"]');
    expect(storage.getItem('documents:x')).toBeNull();
    // The second account starts with nothing of its own.
    session.user = { username: 'bob' };
    expect(accountKey('documents:x', storage)).toBe('documents:x:bob');
    expect(storage.getItem('documents:x:bob')).toBeNull();
    expect(storage.getItem('documents:x:u-ann')).toBe('["kept"]');
  });

  it('keeps one account\'s stars when another signs in and lists different files', () => {
    session.user = { uuid: 'a' };
    toggleStar('Documents/Ann.docx');
    expect(starredPaths()).toEqual(['Documents/Ann.docx']);
    session.user = { uuid: 'b' };
    expect(starredPaths()).toEqual([]);
    expect(pruneStars([{ path: 'Documents/Bob.docx' }])).toEqual([]);
    toggleStar('Documents/Bob.docx');
    session.user = { uuid: 'a' };
    expect(starredPaths()).toEqual(['Documents/Ann.docx']);
    session.user = null;
    expect(starredPaths()).toEqual([]);
  });

  it('keeps goals and reading positions apart between accounts', () => {
    const own = memory();
    session.user = { uuid: 'a' };
    rememberGoal('Documents/Same.docx', 2000, { storage: own });
    rememberPosition('Documents/Same.docx', { blockId: 'p9', offset: 3 }, { storage: own, now: 5 });
    session.user = { uuid: 'b' };
    expect(recallGoal('Documents/Same.docx', { storage: own })).toBeNull();
    expect(recallPosition('Documents/Same.docx', { storage: own })).toBeNull();
    session.user = { uuid: 'a' };
    expect(recallGoal('Documents/Same.docx', { storage: own })).toBe(2000);
    expect(recallPosition('Documents/Same.docx', { storage: own })).toEqual({ blockId: 'p9', offset: 3, at: 5 });
    expect([...own.m.keys()].sort()).toEqual(['documents:goals:a', 'documents:positions:a']);
  });
});
