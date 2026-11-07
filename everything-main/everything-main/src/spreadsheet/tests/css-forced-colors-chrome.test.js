import { describe, expect, it } from 'vitest';
import { stylesheet, parseRules, declared, rulesFor } from './helpers/css.js';

const MODE = 'forced-colors: active';
const components = stylesheet('components.css');
const editor = stylesheet('editor.css');

// Windows High Contrast repaints every background in the system's colours and drops every
// box-shadow. The app's keyboard-focus rings are inset box-shadows behind `outline: none`, its
// pressed, open and chosen states are fills, its separators are filled boxes and its colour
// swatches are nothing but their fill: all of it vanished. Each now has a form the mode keeps.
describe('forced colours', () => {
  it('gives every focus rule that removes the outline one the mode paints, in both sheets', () => {
    let count = 0;
    for (const [name, css] of [['components.css', components], ['editor.css', editor]]) {
      const selectors = new Set(parseRules(css).filter((r) => !r.media.length).flatMap((r) => r.selectors).filter((s) => s.includes(':focus')));
      for (const selector of selectors) {
        if (declared(css, selector, false).outline !== 'none') continue;
        count++;
        // A transparent outline is still an outline to the mode, which paints it in its own colour.
        expect(declared(css, selector, MODE).outline, `${name}: ${selector}`).toBe('2px solid transparent');
      }
    }
    expect(count).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['components.css', '.menu-item:focus-visible'], ['components.css', '.dp-day:focus-visible'],
    ['components.css', '.modal-panel:focus-visible'], ['components.css', '.palette-input:focus'],
    ['editor.css', '.name-box:focus'], ['editor.css', '.formula-input:focus'],
    ['editor.css', '.name-menu-btn:focus-visible'], ['editor.css', '.fx-expand:focus-visible'],
  ])('%s: %s keeps a visible focus indicator', (name, selector) => {
    const decls = declared(name === 'editor.css' ? editor : components, selector, MODE);
    expect(decls.outline).toBe('2px solid transparent');
    expect(decls['outline-offset']).toBe('-2px');
  });

  it.each([
    ['components.css', '.palette-item[aria-selected="true"]'], ['components.css', '.dp-day.selected'],
    ['editor.css', '.tb-btn[aria-pressed="true"]'], ['editor.css', '.menubar-btn.open'],
    ['editor.css', '.menubar-btn[aria-expanded="true"]'], ['editor.css', '.tab.active'],
  ])('%s: %s shows its state in the system selection colours', (name, selector) => {
    const css = name === 'editor.css' ? editor : components;
    const decls = declared(css, selector, MODE);
    expect(decls.background).toBe('Highlight');
    expect(decls.color).toBe('HighlightText');
    // A focus ring drawn inside that fill must not be the fill's colour.
    if (selector !== '.dp-day.selected' && selector !== '.palette-item[aria-selected="true"]') {
      expect(declared(css, `${selector}:focus-visible`, MODE)['outline-color']).toBe('HighlightText');
    }
  });

  it.each([
    '.seg-btn[aria-checked="true"]', '.fc-tabs .seg-btn[aria-selected="true"]',
    '.segmented button[aria-checked="true"]', '.chart-type[aria-checked="true"]',
  ])('%s says it is the chosen option of its group', (selector) => {
    // Outside the mode each of these is a fill, a border colour or a box-shadow, and all three go.
    expect(Object.keys(declared(components, selector, false)).length).toBeGreaterThan(0);
    const decls = declared(components, selector, MODE);
    expect(decls.background).toBe('Highlight');
    expect(decls.color).toBe('HighlightText');
    expect(declared(components, `${selector}:focus-visible`, MODE)['outline-color']).toBe('HighlightText');
  });

  it('marks the chosen table style by its border, the one part of the card its bands do not cover', () => {
    expect(declared(components, '.table-style[aria-checked="true"]', MODE)['border-color']).toBe('Highlight');
  });

  it('draws the column-statistics bars in the text colour and keeps the track', () => {
    // Their length is the reading, not their colour, and the accent may be the high-contrast canvas's own shade.
    expect(declared(components, '.hist-bar', MODE).background).toBe('CanvasText');
    expect(declared(components, '.freq-fill', MODE).background).toBe('CanvasText');
    expect(declared(components, '.freq-bar', MODE).border).toBe('1px solid CanvasText');
  });

  it('keeps the muted parts of the chosen palette row readable on the selection fill', () => {
    expect(declared(components, '.palette-item[aria-selected="true"] .palette-section', MODE).color).toBe('HighlightText');
    expect(declared(components, '.palette-item[aria-selected="true"] .menu-shortcut', MODE).color).toBe('HighlightText');
    expect(declared(components, '.palette-item[aria-selected="true"] .menu-icon', MODE).color).toBe('HighlightText');
    expect(declared(editor, '.tab-item.active::after', MODE).background).toBe('Highlight');
  });

  it.each([
    ['components.css', '.swatch'], ['components.css', '.menu-swatch'], ['components.css', '.cell-style-sample'], ['components.css', '.chip-color-row .chip'],
    ['components.css', '.table-style-head'], ['components.css', '.table-style-band'],
    ['editor.css', '.color-bar'], ['editor.css', '.tab.colored::before'], ['editor.css', '.tab-item.colored::before'],
    ['editor.css', '.cf-preview'],
  ])('%s: %s keeps the colour it exists to show', (name, selector) => {
    expect(declared(name === 'editor.css' ? editor : components, selector, MODE)['forced-color-adjust']).toBe('none');
  });

  it('gives the toast an edge of its own once its fill is repainted', () => {
    // Outside the mode the toast is an ink fill with no border, and the fill becomes the canvas colour.
    expect(declared(components, '.toast', false).background).toBe('var(--ink)');
    expect(declared(components, '.toast', false).border).toBeUndefined();
    expect(declared(components, '.toast', MODE).border).toBe('1px solid CanvasText');
    // Undo and Dismiss lose their color-mix fills the same way, so they get a button's edge.
    for (const sel of ['.toast-action', '.toast-close']) expect(declared(components, sel, MODE).border, sel).toBe('1px solid ButtonText');
    // The floating surfaces that already survive the mode, for comparison.
    for (const sel of ['.menu', '.palette-panel']) expect(declared(components, sel, false).border, sel).toBe('1px solid var(--hairline-strong)');
  });

  it('draws the separators and the sheet handle as lines the mode keeps', () => {
    const sep = declared(components, '.menu-sep', MODE);
    expect(sep.background).toBe('none');
    expect(sep['border-top']).toBe('1px solid CanvasText');
    expect(sep.height).toBe('0');
    const tb = declared(editor, '.tb-sep', MODE);
    expect(tb.background).toBe('none');
    expect(tb['border-left']).toBe('1px solid CanvasText');
    expect(tb.width).toBe('0');
    expect(declared(components, '.sheet-handle', MODE).background).toBe('CanvasText');
  });

  it('paints the "no colour" swatch in the canvas colour with its slash in the text colour', () => {
    expect(declared(components, '.swatch.none', MODE).background).toBe('Canvas !important');
    expect(declared(components, '.swatch.none::after', MODE).background).toBe('CanvasText');
    expect(declared(components, '.swatch.custom::after', MODE).background).toBe('Canvas');
    expect(declared(components, '.swatch:focus-visible', MODE)['outline-color']).toBe('Highlight');
    // The block exists in both sheets exactly once, so a rule added later has a home.
    expect(rulesFor(components, '.swatch', MODE).length).toBe(1);
    expect(rulesFor(editor, '.color-bar', MODE).length).toBe(1);
  });
});
