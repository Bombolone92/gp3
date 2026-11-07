import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';

// Outline groups draw their brackets in the header gutter with the third ink faded to 0.7, which
// was 2.8:1 in the light theme: a boundary that has to be seen needs 3:1 (WCAG 1.4.11).
it('draws the outline brackets at 3:1 on the header gutter in both themes', () => {
  const line = declared(stylesheet('grid.css'), '.outline-line', false); // the everyday rule, not the forced-colors one
  expect(line.background).toBe('var(--ink-3)');
  const opacity = Number(line.opacity);
  expect(opacity).toBeGreaterThanOrEqual(0.85);
  expect(opacity).toBeLessThan(1); // still a bracket, not a rule
  for (const theme of ['light', 'dark']) {
    const t = themeTokens(theme);
    const gutter = parseColor(t['surface-2']);
    const drawn = over([...parseColor(t['ink-3']).slice(0, 3), opacity], gutter);
    expect(contrast(drawn, gutter), theme).toBeGreaterThanOrEqual(3);
  }
});
