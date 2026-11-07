import { describe, it, expect, beforeEach } from 'vitest';
import { starredPaths, isStarred, toggleStar, moveStar, forgetStar, pruneStars, starredFirst } from '../src/lib/starred.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

describe('starred documents', () => {
  beforeEach(() => store.clear());

  it('stars and unstars by path, remembering the order', () => {
    expect(starredPaths()).toEqual([]);
    expect(toggleStar('Documents/A.docx')).toBe(true);
    expect(toggleStar('Documents/B.docx')).toBe(true);
    expect(isStarred('Documents/A.docx')).toBe(true);
    expect(starredPaths()).toEqual(['Documents/A.docx', 'Documents/B.docx']);
    expect(toggleStar('Documents/A.docx')).toBe(false);
    expect(starredPaths()).toEqual(['Documents/B.docx']);
    expect(toggleStar('')).toBe(false);
    expect(isStarred(null)).toBe(false);
  });

  it('follows a rename and forgets a deletion', () => {
    toggleStar('Documents/A.docx');
    moveStar('Documents/A.docx', 'Documents/Renamed.docx');
    expect(starredPaths()).toEqual(['Documents/Renamed.docx']);
    moveStar('Documents/Nope.docx', 'Documents/X.docx');
    expect(starredPaths()).toEqual(['Documents/Renamed.docx']);
    forgetStar('Documents/Renamed.docx');
    expect(starredPaths()).toEqual([]);
  });

  it('prunes stars for missing files and puts starred files first', () => {
    toggleStar('Documents/B.docx');
    toggleStar('Documents/Gone.docx');
    const files = [{ path: 'Documents/A.docx' }, { path: 'Documents/B.docx' }, { path: 'Documents/C.docx' }];
    expect(pruneStars(files)).toEqual(['Documents/B.docx']);
    expect(starredPaths()).toEqual(['Documents/B.docx']);
    expect(starredFirst(files).map((f) => f.path)).toEqual(['Documents/B.docx', 'Documents/A.docx', 'Documents/C.docx']);
    expect(starredFirst(files, []).map((f) => f.path)).toEqual(['Documents/A.docx', 'Documents/B.docx', 'Documents/C.docx']);
  });

  it('survives corrupt storage', () => {
    store.set('documents:starred', '{bad');
    expect(starredPaths()).toEqual([]);
    store.set('documents:starred', JSON.stringify([1, null, 'Documents/A.docx']));
    expect(starredPaths()).toEqual(['Documents/A.docx']);
  });
});
