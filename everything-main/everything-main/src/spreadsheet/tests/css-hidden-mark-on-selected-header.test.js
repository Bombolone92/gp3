import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';

// The mark a hidden row or column leaves on its neighbour's header is the accent at 0.85, which on a
// selected header, filled with the accent, was 1:1: selecting column C beside a hidden B hid B's only sign.
it('draws the hidden-line mark at 3:1 on a selected header in both themes', () => {
  const css = stylesheet('grid.css');
  const mark = declared(css, '.hcell.after-hidden::before', false);
  expect(declared(css, '.hcell.sel.after-hidden::before', false).background).toBe('var(--accent-ink)');
  expect(declared(css, '.hcell.sel.before-hidden::after', false).background).toBe('var(--accent-ink)');
  for (const theme of ['light', 'dark']) {
    const t = themeTokens(theme);
    const fill = parseColor(t.accent);
    const drawn = over([...parseColor(t['accent-ink']).slice(0, 3), Number(mark.opacity)], fill);
    expect(contrast(drawn, fill), theme).toBeGreaterThanOrEqual(3);
  }
});
