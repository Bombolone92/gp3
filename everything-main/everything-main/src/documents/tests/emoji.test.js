import { describe, it, expect, beforeEach } from 'vitest';
import { EMOJI_CATEGORIES, emojiName, allEmoji, searchEmoji, recentEmoji, rememberEmoji, entryFor } from '../src/ui/emoji.js';

describe('emoji data', () => {
  it('has categories of well-formed unique entries', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThan(3);
    const chars = new Set();
    for (const [, list] of EMOJI_CATEGORIES) {
      for (const entry of list) {
        expect(Array.isArray(entry)).toBe(true);
        expect(typeof entry[0]).toBe('string');
        expect(entry[0].length).toBeGreaterThan(0);
        expect(entry[1].trim().length).toBeGreaterThan(0);
        expect(chars.has(entry[0])).toBe(false);
        chars.add(entry[0]);
      }
    }
    expect(allEmoji().length).toBe(chars.size);
    expect(allEmoji().length).toBeGreaterThan(150);
  });

  it('names an entry by the words before the first comma, or all of them', () => {
    expect(emojiName(['👍', 'thumbs up, like yes'])).toBe('thumbs up');
    expect(emojiName(['🍕', 'pizza'])).toBe('pizza');
    expect(emojiName(['🌭', 'hot dog'])).toBe('hot dog');
    expect(emojiName(['x', ''])).toBe('x');
  });

  it('gives every emoji a name of its own, so a screen reader can tell thumbs up from thumbs down', () => {
    const names = allEmoji().map(emojiName);
    const seen = new Map();
    for (const name of names) seen.set(name, (seen.get(name) || 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([name]) => name)).toEqual([]);
    expect(emojiName(entryFor('👍'))).toBe('thumbs up');
    expect(emojiName(entryFor('👎'))).toBe('thumbs down');
    expect(emojiName(entryFor('❤️'))).toBe('red heart');
    expect(emojiName(entryFor('🚩'))).toBe('red flag');
    // Names have no stray punctuation and are not bare adjectives left over from the keyword list.
    for (const name of names) expect(name).toMatch(/^[a-z][a-z ]*[a-z]$|^[a-z]$/);
  });
});

describe('searchEmoji', () => {
  it('matches every query word against names and keywords', () => {
    expect(searchEmoji('thumbs up').map((e) => e[0])).toContain('👍');
    // A search spanning the name and a keyword: the comma between them is not a word.
    expect(searchEmoji('up like').map((e) => e[0])).toEqual(['👍']);
    expect(searchEmoji('pointing').map((e) => e[0])).toEqual(['👈', '👉', '👆', '👇', '☝️']);
    expect(searchEmoji('pizza').map((e) => e[0])).toEqual(['🍕']);
    expect(searchEmoji('heart').length).toBeGreaterThan(3);
    expect(searchEmoji('LAUGH').length).toBeGreaterThan(0);
    expect(searchEmoji('')).toEqual([]);
    expect(searchEmoji('   ')).toEqual([]);
    expect(searchEmoji('notarealemojiname')).toEqual([]);
  });

  it('returns each emoji at most once', () => {
    const found = searchEmoji('face');
    expect(new Set(found.map((e) => e[0])).size).toBe(found.length);
  });
});

describe('recent emoji', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  });

  it('remembers used emoji most-recent-first without duplicates', () => {
    expect(recentEmoji()).toEqual([]);
    rememberEmoji('😀');
    rememberEmoji('🍕');
    rememberEmoji('😀');
    expect(recentEmoji()).toEqual(['😀', '🍕']);
  });

  it('caps the list and survives bad storage', () => {
    for (let i = 0; i < 40; i++) rememberEmoji(String.fromCodePoint(0x1f600 + i));
    expect(recentEmoji().length).toBe(24);
    globalThis.localStorage.setItem('documents:recent-emoji', 'not json');
    expect(recentEmoji()).toEqual([]);
  });

  it('finds the entry for a character or falls back to the character', () => {
    expect(entryFor('🍕')).toEqual(['🍕', 'pizza']);
    expect(entryFor('🟩')).toEqual(['🟩', '🟩']);
  });
});
