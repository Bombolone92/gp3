import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';

// The date picker's days of the neighbouring months are set in the third ink, and kept it on the accent
// wash a hovered or focused day takes: 4.0:1 in the dark theme, under the 4.5:1 small text needs.
it('steps a neighbouring month\'s day up to the second ink when it is hovered or focused, and reads at 4.5:1 there', () => {
  const css = stylesheet('components.css');
  expect(declared(css, '.dp-day.other').color).toBe('var(--ink-3)');
  expect(declared(css, '.dp-day.other:focus-visible').color).toBe('var(--ink-2)');
  expect(declared(css, '.dp-day.other:hover', 'hover').color).toBe('var(--ink-2)');
  expect(declared(css, '.dp-day:focus-visible').background).toBe('var(--accent-wash)');
  for (const theme of ['light', 'dark']) {
    const t = themeTokens(theme);
    const wash = over(parseColor(t['accent-wash']), parseColor(t.surface));
    expect(contrast(parseColor(t['ink-2']), wash), theme).toBeGreaterThanOrEqual(4.5);
    expect(contrast(parseColor(t['ink-3']), parseColor(t.surface)), `${theme}, at rest`).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(parseColor(themeTokens('dark')['ink-3']), over(parseColor(themeTokens('dark')['accent-wash']), parseColor(themeTokens('dark').surface)))).toBeLessThan(4.5); // why it steps up
});
