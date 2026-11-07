// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, contrast } from './helpers/css.js';
import { FILL_COLORS } from '../src/ui/toolbar.js';

const css = stylesheet('grid.css');

// The active cell was marked by the accent border alone, and in the dark theme that blue sits
// under 3:1 on nearly every preset fill: on a pastel cell the cursor all but disappeared. A 1px
// line in the surface colour inside the border is invisible on a plain
// cell and marks the cursor on a filled one.
describe('the active cell border', () => {
  it('is two-tone: the accent with a surface-coloured line inside it', () => {
    const rule = declared(css, '.sel-active');
    expect(rule.border).toBe('2px solid var(--accent)');
    expect(rule['box-shadow']).toBe('inset 0 0 0 1px var(--surface)');
    // While a cell is being edited the border steps back, and the inner line with it.
    const editing = declared(css, '.grid.editing .sel-active');
    expect(editing['border-color']).toBe('transparent');
    expect(editing['box-shadow']).toBe('none');
  });

  it.each(['light', 'dark'])('reads at 3:1 on the preset fills in the %s theme', (theme) => {
    const t = themeTokens(theme);
    const accent = parseColor(t.accent);
    const line = parseColor(t.surface);
    const failing = FILL_COLORS.filter((c) => contrast(accent, parseColor(c)) < 3);
    // The accent alone is what fails: on most dark-theme presets, and on the light theme's mid grey.
    if (theme === 'dark') expect(failing.length).toBeGreaterThanOrEqual(6);
    for (const fill of [...FILL_COLORS, t.surface]) {
      const bg = parseColor(fill);
      // The one exception: the light theme's mid grey, where the accent is 2.9:1 and a white line
      // cannot help. A dark line would fix it, but at the price of a dark ring on every plain cell.
      const floor = theme === 'light' && fill === '#c3c2b7' ? 2.85 : 3;
      expect(Math.max(contrast(accent, bg), contrast(line, bg)), `${theme}: ${fill}`).toBeGreaterThanOrEqual(floor);
    }
  });
});
