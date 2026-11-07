import { describe, it, expect, vi } from 'vitest';
import { sanitizeBookmarkName, validateBookmarkName, headingBookmarkName, isHiddenBookmark, anchorFromHref, listBookmarks, bookmarkForBlock, insertBookmark, removeBookmark, ensureHeadingBookmark, placeChoices, choiceForAnchor, linkToPlace } from '../src/lib/bookmarks.js';

describe('bookmark names', () => {
  it('says a name typed with the reserved underscore prefix is reserved, and keeps combining marks', () => {
    expect(validateBookmarkName('_Ref1')).toBe('Names starting with an underscore are reserved');
    expect(validateBookmarkName('  _hidden')).toBe('Names starting with an underscore are reserved');
    expect(sanitizeBookmarkName('cafe\u0301')).toBe('cafe\u0301');
    expect(validateBookmarkName('cafe\u0301')).toBeNull();
  });

  it('follows the bookmark naming rules', () => {
    expect(sanitizeBookmarkName('  Chapter one ')).toBe('Chapter_one');
    expect(sanitizeBookmarkName('2nd part')).toBe('nd_part');
    expect(sanitizeBookmarkName('Résumé!')).toBe('Résumé');
    expect(sanitizeBookmarkName('x'.repeat(50))).toHaveLength(40);
    expect(sanitizeBookmarkName('___')).toBe('');
    // A letter outside the Basic Multilingual Plane at the cut is dropped whole, not halved.
    expect(sanitizeBookmarkName(`${'a'.repeat(39)}𐐷b`)).toBe('a'.repeat(39));
    expect(sanitizeBookmarkName(`${'a'.repeat(38)}𐐷b`)).toBe(`${'a'.repeat(38)}𐐷`);
    expect(validateBookmarkName('Intro', [{ name: 'Other' }])).toBeNull();
    expect(validateBookmarkName('Intro', [{ name: 'Intro' }])).toMatch(/already exists/);
    expect(validateBookmarkName('!!!')).toMatch(/letters/);
    expect(headingBookmarkName('4196-4671')).toBe('_Ref41964671');
    expect(isHiddenBookmark('_Ref1')).toBe(true);
    expect(isHiddenBookmark('Intro')).toBe(false);
  });

  it('reads the anchor from an href', () => {
    expect(anchorFromHref('#Intro')).toBe('Intro');
    expect(anchorFromHref('#_Ref%201')).toBe('_Ref 1');
    expect(anchorFromHref('#chapter%')).toBe('chapter%');
    expect(anchorFromHref('#%E9')).toBe('%E9');
    expect(anchorFromHref('#%ZZ')).toBe('%ZZ');
    expect(anchorFromHref('https://example.com/#x')).toBeNull();
    expect(anchorFromHref('')).toBeNull();
  });
});

describe('bookmarks through the API', () => {
  const fake = (items = []) => {
    const calls = [];
    const api = {
      bookmarks: {
        list: async () => ({ items }),
        insert: async (i) => { calls.push(['insert', i]); return { success: true }; },
        remove: async (i) => { calls.push(['remove', i]); return { success: true }; },
      },
      hyperlinks: { wrap: async (i) => { calls.push(['wrap', i]); return { success: true }; } },
    };
    return { api, calls };
  };
  const items = [
    { name: 'Intro', range: { from: { blockId: 'p1', offset: 0 }, to: { blockId: 'p1', offset: 9 } } },
    { name: '_Ref2', range: { from: { blockId: 'p2', offset: 0 } } },
    { name: 'Also', range: { from: { blockId: 'p2', offset: 0 } } },
  ];

  it('lists bookmarks with their paragraph and picks the user\'s over hidden ones', async () => {
    const { api } = fake(items);
    const list = await listBookmarks(api);
    expect(list).toEqual([{ name: 'Intro', blockId: 'p1', hidden: false }, { name: '_Ref2', blockId: 'p2', hidden: true }, { name: 'Also', blockId: 'p2', hidden: false }]);
    expect(bookmarkForBlock(list, 'p2').name).toBe('Also');
    expect(bookmarkForBlock(list, 'p1').name).toBe('Intro');
    expect(bookmarkForBlock(list, 'p9')).toBeNull();
  });

  it('inserts on the paragraph, removes by name, and reuses or makes a heading bookmark', async () => {
    const { api, calls } = fake(items);
    await insertBookmark(api, 'p3', 'Notes');
    expect(calls[0]).toEqual(['insert', { name: 'Notes', at: { kind: 'text', blockId: 'p3', range: { start: 0, end: 0 } } }]);
    await removeBookmark(api, 'Notes');
    expect(calls[1]).toEqual(['remove', { target: { kind: 'entity', entityType: 'bookmark', name: 'Notes' } }]);
    expect(await ensureHeadingBookmark(api, 'p1')).toBe('Intro');
    expect(await ensureHeadingBookmark(api, 'p7')).toBe('_Refp7');
    expect(calls[2][1].name).toBe('_Refp7');
    await expect(insertBookmark(api, null, 'x')).rejects.toThrow('Place the cursor');
    await expect(insertBookmark({ bookmarks: { insert: async () => ({ success: false, failure: { message: 'dup' } }) } }, 'p1', 'x')).rejects.toThrow('dup');
  });

  it('remembers and reports a heading bookmark only after creation succeeds', async () => {
    const { api } = fake();
    const insert = vi.spyOn(api.bookmarks, 'insert').mockResolvedValueOnce({ success: false, failure: { message: 'Unavailable' } });
    const cached = [], onCreated = vi.fn();
    await expect(ensureHeadingBookmark(api, 'p1', cached, { onCreated })).rejects.toThrow('Unavailable');
    expect(cached).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();
    expect(await ensureHeadingBookmark(api, 'p1', cached, { onCreated })).toBe('_Refp1');
    expect(await ensureHeadingBookmark(api, 'p1', cached, { onCreated })).toBe('_Refp1');
    expect(insert).toHaveBeenCalledTimes(2);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(cached).toEqual([{ name: '_Refp1', blockId: 'p1', hidden: true }]);
  });

  it('offers headings and named bookmarks as places, and finds the choice for an anchor', () => {
    const bookmarks = [{ name: 'Intro', blockId: 'p1', hidden: false }, { name: '_Ref2', blockId: 'p2', hidden: true }];
    const choices = placeChoices([{ nodeId: 'p2', text: 'Chapter 2', level: 1 }], bookmarks);
    expect(choices.map((c) => c.id)).toEqual(['h:p2', 'b:Intro']);
    expect(choiceForAnchor(choices, 'Intro', bookmarks)).toBe('b:Intro');
    expect(choiceForAnchor(choices, '_Ref2', bookmarks)).toBe('h:p2');
    expect(choiceForAnchor(choices, 'nope', bookmarks)).toBeNull();
    expect(choiceForAnchor(choices, null)).toBeNull();
  });

  it('wraps a range, or types the text first when the caret is collapsed', async () => {
    const { api, calls } = fake();
    await linkToPlace(api, { blockId: 'p1', start: 3, end: 8 }, 'Intro');
    expect(calls[0]).toEqual(['wrap', { target: { kind: 'text', blockId: 'p1', range: { start: 3, end: 8 } }, link: { destination: { anchor: 'Intro' } } }]);
    const typed = [];
    await linkToPlace(api, { blockId: 'p1', start: 4, end: 4, text: 'see intro', insertText: async (t) => { typed.push(t); return true; } }, 'Intro');
    expect(typed).toEqual(['see intro']);
    expect(calls[1][1].target.range).toEqual({ start: 4, end: 13 });
    await expect(linkToPlace(api, { blockId: 'p1', start: 4, end: 4 }, 'Intro')).rejects.toThrow('Enter the link text');
    await expect(linkToPlace(api, { blockId: 'p1', start: 4, end: 4, text: 'x', insertText: async () => false }, 'Intro')).rejects.toThrow('could not be typed');
    await expect(linkToPlace(api, { blockId: null, start: 0, end: 1 }, 'Intro')).rejects.toThrow('Place the cursor');
  });
});
