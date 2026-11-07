import { describe, expect, it } from 'vitest';
import { stylesheet, parseRules, declared } from './helpers/css.js';

const sheets = ['base.css', 'components.css', 'grid.css', 'editor.css', 'views.css'];

// A touch screen has no hover, but a tap leaves the tapped element "hovered" until the next tap:
// Bold turned off on a phone kept its hover fill, and a sheet tab stayed highlighted. Hover
// styling is for pointers that can hover.
describe('hover styling', () => {
  it('is gated by (hover: hover) in every stylesheet, with no other selector sharing the rule', () => {
    let count = 0;
    for (const name of sheets) {
      for (const rule of parseRules(stylesheet(name))) {
        if (!rule.selectors.some((s) => s.includes(':hover'))) continue;
        count++;
        const where = `${name}: ${rule.selectors.join(', ')}`;
        expect(rule.media.some((m) => m.includes('hover: hover')), where).toBe(true);
        expect(rule.selectors.every((s) => s.includes(':hover')), where).toBe(true);
      }
    }
    expect(count).toBeGreaterThanOrEqual(38);
  });

  it('keeps the keyboard and state twins of hover rules for every input', () => {
    const components = stylesheet('components.css');
    const editor = stylesheet('editor.css');
    const grid = stylesheet('grid.css');
    expect(declared(components, '.menu-item:focus-visible', false).background).toBe('var(--surface-2)');
    expect(declared(components, '.dp-day:focus-visible', false).background).toBe('var(--accent-wash)');
    expect(declared(editor, '.menubar-btn[aria-expanded="true"]', false).background).toBe('var(--surface-2)');
    expect(declared(editor, '.menubar-btn.open', false).background).toBe('var(--surface-2)');
    expect(declared(editor, '.name-menu-btn:focus-visible', false).background).toBe('var(--accent-wash)');
    expect(declared(editor, '.fx-expand:focus-visible', false).background).toBe('var(--accent-wash)');
    expect(declared(grid, '.freeze-bar.dragging', false).background).toBe('var(--accent)');
    // The hover twins carry the same declarations, under the gate.
    expect(declared(components, '.menu-item:hover', 'hover: hover').background).toBe('var(--surface-2)');
    expect(declared(editor, '.tb-btn:hover', 'hover: hover').background).toBe('var(--surface-2)');
    expect(declared(editor, '.tab:hover', 'hover: hover').background).toBe('var(--surface-3)');
    expect(declared(grid, '.hcell:hover', 'hover: hover').background).toBe('var(--surface-3)');
  });
});
