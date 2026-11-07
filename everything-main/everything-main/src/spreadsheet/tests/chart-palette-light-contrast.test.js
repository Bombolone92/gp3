import { describe, expect, it } from 'vitest';
import { SERIES_COLORS, inkOn } from '../src/ui/chartsvg.js';
import { themeTokens, parseColor, contrast } from './helpers/css.js';

// Chart fills, and the reference highlights in the grid that borrow the same tokens, are
// graphics that carry meaning, so they need 3:1 against the sheet (WCAG 1.4.11). In the light
// theme the green, amber and pink series fell short (2.8, 2.2 and 2.7 on white). The light
// values are darker now; the dark theme's were already well clear.
describe('the light series palette', () => {
  const light = themeTokens('light');
  const dark = themeTokens('dark');
  const tokenSeries = (t) => ['series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-7'].map((k) => t[k]);

  it('reads at 3:1 on the light sheet and page, in the stylesheet and in the chart renderer alike', () => {
    for (const bg of ['surface', 'page']) {
      for (const hex of SERIES_COLORS) expect(contrast(parseColor(hex), parseColor(light[bg])), `${hex} on ${bg}`).toBeGreaterThanOrEqual(3);
      for (const hex of tokenSeries(light)) expect(contrast(parseColor(hex), parseColor(light[bg])), `${hex} on ${bg}`).toBeGreaterThanOrEqual(3);
    }
    // The stylesheet's light tokens and the renderer's palette are the same colours in the same order.
    expect(tokenSeries(light)).toEqual(SERIES_COLORS.slice(0, 6));
  });

  it('keeps the dark theme’s lighter fills, which already read on the dark sheet', () => {
    for (const hex of tokenSeries(dark)) expect(contrast(parseColor(hex), parseColor(dark.surface)), hex).toBeGreaterThanOrEqual(3);
    expect(dark['series-3']).toBe('#2dc48f');
    expect(dark['series-4']).toBe('#f0b429');
    expect(dark['series-5']).toBe('#f28cb5');
  });

  it('still gets a readable label ink on every fill, with room to spare at the threshold', () => {
    for (const hex of SERIES_COLORS) {
      const ink = inkOn(hex);
      expect(contrast(parseColor(ink), parseColor(hex)), `${ink} on ${hex}`).toBeGreaterThanOrEqual(4.6);
    }
    // The darkened green and amber keep dark labels; the pink is deep enough for white ones.
    expect(inkOn(SERIES_COLORS[2])).toBe('#0b0b0b');
    expect(inkOn(SERIES_COLORS[3])).toBe('#0b0b0b');
    expect(inkOn(SERIES_COLORS[4])).toBe('#ffffff');
  });
});
