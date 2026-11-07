// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openEmojiPicker } from '../src/ui/emoji.js';
import { closeAllModals } from '../src/ui/modal.js';

describe('emoji picker keyboard', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.matchMedia = () => ({ matches: true, addEventListener() {} });
    localStorage.clear();
  });
  afterEach(() => { closeAllModals(); document.body.replaceChildren(); });
  const type = (input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const press = (node, key) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  it('picks the first match on Enter in the search field and moves into the results on Down', () => {
    const picked = [];
    openEmojiPicker({ onPick: (ch) => picked.push(ch) });
    const search = document.querySelector('[aria-label="Search emoji"]');
    // Enter with nothing searched does nothing; it must not pick a category's first emoji.
    press(search, 'Enter');
    expect(picked).toEqual([]);
    type(search, 'pizza');
    const results = document.querySelector('[aria-label="Search results"]');
    expect(results.hidden).toBe(false);
    expect([...results.children].map((b) => b.tabIndex)).toEqual([0]);
    press(search, 'ArrowDown');
    expect(document.activeElement).toBe(results.firstChild);
    press(search, 'Enter');
    expect(picked).toEqual(['🍕']);
    expect(document.querySelector('.modal-root').classList.contains('closing')).toBe(true);
  });

  it('gives each category one Tab stop and keeps it after a cleared search', () => {
    openEmojiPicker({ onPick: () => {} });
    const search = document.querySelector('[aria-label="Search emoji"]');
    const grids = [...document.querySelectorAll('.emoji-picker section .symbol-grid')];
    expect(grids.length).toBeGreaterThan(3);
    expect(document.querySelectorAll('.emoji-picker section .symbol[tabindex="0"]')).toHaveLength(grids.length);
    type(search, 'heart');
    type(search, '');
    expect(document.querySelectorAll('.emoji-picker section .symbol[tabindex="0"]')).toHaveLength(grids.length);
    const nothing = document.querySelector('[aria-label="Search results"]');
    type(search, 'notarealemojiname');
    expect(nothing.hidden).toBe(true);
    press(search, 'Enter');
    expect(document.querySelector('.modal-root').classList.contains('closing')).toBe(false);
  });
});
