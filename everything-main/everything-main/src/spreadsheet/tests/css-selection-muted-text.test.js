import { describe, expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';

// Selected text kept its own colour over the translucent selection colour, so the muted text of hints,
// notes, file details and the shortcuts' key column fell to 2.2:1 in the dark theme (3.5:1 in the light)
// while selected. The selection now sets the strongest ink as well as its background.
describe('text under the selection highlight', () => {
  it('takes the strongest ink', () => {
    const rule = declared(stylesheet('base.css'), '::selection');
    expect(rule.background).toBe('var(--selection)');
    expect(rule.color).toBe('var(--ink)');
  });

  it.each(['light', 'dark'])('reads at 4.5:1 on every surface in the %s theme, where the muted inks did not', (theme) => {
    const t = themeTokens(theme);
    for (const surface of ['surface', 'surface-2', 'page']) {
      const highlighted = over(parseColor(t.selection), parseColor(t[surface]));
      expect(contrast(parseColor(t.ink), highlighted), `ink on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    const onSurface = over(parseColor(t.selection), parseColor(t.surface));
    if (theme === 'dark') {
      expect(contrast(parseColor(t['ink-3']), onSurface)).toBeLessThan(4.5); // why the selection names its ink
      expect(contrast(parseColor(t['ink-2']), onSurface)).toBeLessThan(4.5); // and why the second ink would not do
    }
  });
});
