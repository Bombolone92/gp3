import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, contrast } from './helpers/css.js';

// A toast is drawn in ink with page-coloured text; its action button took the global accent
// focus ring, which on the dark theme's light ink was 2.9:1. The ring now uses the page colour,
// the same colour the toast's own text already reads in.
it('draws the toast action focus ring in a colour that reads on the ink-coloured toast', () => {
  const css = stylesheet('components.css');
  expect(declared(css, '.toast').background).toBe('var(--ink)');
  expect(declared(css, '.toast-action:focus-visible')['outline-color']).toBe('var(--page)');
  for (const theme of ['light', 'dark']) {
    const t = themeTokens(theme);
    expect(contrast(parseColor(t.page), parseColor(t.ink)), `${theme}: ring on the toast`).toBeGreaterThanOrEqual(3);
  }
  // The dark theme is the one the accent ring failed on.
  const dark = themeTokens('dark');
  expect(contrast(parseColor(dark.accent), parseColor(dark.ink))).toBeLessThan(3);
});
