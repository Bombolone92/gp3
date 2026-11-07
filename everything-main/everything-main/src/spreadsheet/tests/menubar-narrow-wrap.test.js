import { describe, expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

const css = stylesheet('editor.css');

// The menu bar scrolls sideways with its scrollbar hidden, which suits a thumb but leaves a mouse
// no way to reach a title past the window's edge: under about 424px, Help was clipped and
// unreachable. With a fine pointer the titles wrap onto a second row instead.
describe('the menu bar in a narrow window', () => {
  it('wraps its titles under a fine pointer instead of hiding them past the edge', () => {
    const fine = declared(css, '.menubar', 'pointer: fine');
    expect(fine['flex-wrap']).toBe('wrap');
    expect(fine.height).toBe('auto');
    expect(fine['min-height']).toBe('var(--menubar-h)');
    expect(fine.overflow).toBe('visible');
  });

  it('keeps the swipeable strip for touch screens', () => {
    const base = declared(css, '.menubar', false);
    expect(base['overflow-x']).toBe('auto');
    expect(base['flex-wrap']).toBeUndefined();
    expect(base.height).toBe('var(--menubar-h)');
  });
});
