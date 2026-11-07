import { describe, expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';

const grid = stylesheet('grid.css');
const components = stylesheet('components.css');

// The highlighted row of the function hints and of the command palette is washed with the accent,
// and its muted text (a function's description, a command's section) stayed in the third ink:
// 4.4:1 in the dark theme, under the 4.5:1 that small text needs.
describe('muted text on a highlighted row', () => {
  it('steps up to the second ink on the accent wash and keeps the third ink elsewhere', () => {
    expect(declared(grid, '.fx-item.selected .fx-desc').color).toBe('var(--ink-2)');
    // The theme's own rules: under forced colours the row takes the system's selection pair instead.
    expect(declared(components, '.palette-item[aria-selected="true"] .palette-section', false).color).toBe('var(--ink-2)');
    // The shortcut column of the row Enter will run sits on the same wash and needs the same ink.
    expect(declared(components, '.palette-item[aria-selected="true"] .menu-shortcut', false).color).toBe('var(--ink-2)');
    expect(declared(grid, '.fx-desc').color).toBe('var(--ink-3)');
    expect(declared(components, '.palette-section').color).toBe('var(--ink-3)');
    expect(declared(components, '.menu-shortcut').color).toBe('var(--ink-3)'); // unchanged in a menu, where it sits on the second surface
    expect(declared(grid, '.fx-item.selected').background).toBe('var(--accent-wash)');
    expect(declared(components, '.palette-item[aria-selected="true"]', false).background).toBe('var(--accent-wash)');
  });

  it.each(['light', 'dark'])('reads at 4.5:1 in the %s theme', (theme) => {
    const t = themeTokens(theme);
    const wash = over(parseColor(t['accent-wash']), parseColor(t.surface));
    expect(contrast(parseColor(t['ink-2']), wash)).toBeGreaterThanOrEqual(4.5);
    if (theme === 'dark') expect(contrast(parseColor(t['ink-3']), wash)).toBeLessThan(4.5); // why the row switches ink
  });
});
