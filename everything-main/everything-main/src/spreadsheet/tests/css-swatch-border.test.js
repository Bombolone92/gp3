// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { stylesheet, declared, themeTokens, parseColor, over, contrast } from './helpers/css.js';
import { FILL_COLORS } from '../src/ui/toolbar.js';

const css = stylesheet('components.css');

// A colour swatch whose fill matches the menu behind it (white in the light theme, the near-black
// preset in the dark one) was outlined only by the decorative hairline, at 1.5:1: an invisible
// button. The field border is the boundary token that already reads at 3:1 on every surface.
describe('colour swatches', () => {
  it('are outlined with the field border', () => {
    expect(declared(css, '.swatch').border).toBe('1px solid var(--field-border)');
  });

  it.each(['light', 'dark'])('stay visible on the %s menu surface whatever their fill', (theme) => {
    const t = themeTokens(theme);
    const surface = parseColor(t.surface);
    const border = over(parseColor(t['field-border']), surface);
    expect(contrast(border, surface)).toBeGreaterThanOrEqual(3);
    // At least one preset sits within 1.3:1 of the surface: without the border it would vanish.
    expect(FILL_COLORS.some((c) => contrast(parseColor(c), surface) < 1.3)).toBe(true);
    for (const fill of FILL_COLORS) {
      const swatch = parseColor(fill);
      // The translucent border lies over the swatch's own fill; the ring must read on both sides.
      const ring = over(parseColor(t['field-border']), swatch);
      const visible = contrast(swatch, surface) >= 3 || (contrast(ring, swatch) >= 3 && contrast(ring, surface) >= 3);
      expect(visible, `${theme}: ${fill}`).toBe(true);
    }
  });
});
