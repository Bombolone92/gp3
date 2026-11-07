import { describe, expect, it } from 'vitest';
import { stylesheet, declared, parseRules } from './helpers/css.js';

// Windows High Contrast (forced colors) flattens every background to the system canvas, so an
// affordance drawn only as a fill vanished: the fill handle, the selection wash, the selected
// header, the freeze bars, the resize guide, outline brackets and the frozen boundary. System
// colour keywords survive the flattening, and forced-color-adjust keeps the marks whose colours
// carry meaning (data bars, chips).
describe('the grid under forced colors', () => {
  const css = stylesheet('grid.css');
  const forced = (selector) => declared(css, selector, 'forced-colors: active');

  it('has a forced-colors block', () => {
    expect(parseRules(css).some((r) => r.media.some((m) => m.includes('forced-colors: active')))).toBe(true);
  });

  it('draws the selection, its handle and the selected headers in the highlight colour', () => {
    expect(forced('.fill-handle').background).toBe('Highlight');
    expect(forced('.fill-handle').outline).toContain('CanvasText');
    expect(forced('.sel-range').border).toContain('Highlight');
    expect(forced('.sel-active')['border-color']).toBe('Highlight');
    expect(forced('.hcell.sel').background).toBe('Highlight');
    expect(forced('.hcell.sel').color).toBe('HighlightText');
    expect(forced('.hcell.hl').outline).toContain('Highlight');
  });

  it('draws the guides, bars and boundaries in the text colour at full opacity', () => {
    for (const selector of ['.freeze-bar', '.outline-line', '.frz-rows::after', '.frz-cols::after', '.grid-rowhead-frozen::after', '.grid-colhead-frozen::after']) {
      expect(forced(selector).background, selector).toBe('CanvasText');
      expect(forced(selector).opacity, selector).toBe('1');
    }
    expect(forced('.resize-guide').background).toBe('Highlight');
    expect(forced('.resize-guide.move-no').background).toBe('GrayText');
    expect(forced('.freeze-bar.dragging').background).toBe('Highlight');
  });

  it('keeps the colours that carry meaning: data bars and fills of rules, chips, a ticked checkbox', () => {
    for (const selector of ['.cell.cf', '.cell .chip', '.cell.checkbox.checked .checkbox-box']) expect(forced(selector)['forced-color-adjust'], selector).toBe('none');
  });
});
