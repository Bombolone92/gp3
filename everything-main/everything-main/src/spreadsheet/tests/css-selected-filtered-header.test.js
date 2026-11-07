import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, contrast } from './helpers/css.js';

// A row number inside an applied filter is drawn in accent-strong, a rule that came after the selected
// header's and so won on a selected row: accent-strong on the accent fill, 1.3:1 in both themes.
it('keeps a selected filtered row number legible on the accent fill in both themes', () => {
  const css = stylesheet('grid.css');
  expect(declared(css, '.hcell.filtered.sel', false).color).toBe('var(--accent-ink)');
  for (const theme of ['light', 'dark']) {
    const t = themeTokens(theme);
    expect(contrast(parseColor(t['accent-ink']), parseColor(t.accent)), theme).toBeGreaterThanOrEqual(4.5);
  }
});
