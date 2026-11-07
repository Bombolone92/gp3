import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom applies no stylesheet, so the grid's pointer-target and contrast rules are checked as text.
const css = readFileSync(new URL('../src/styles/grid.css', import.meta.url), 'utf8');
/** The declarations of the first rule whose selector list contains `selector`. */
const rule = (selector) => {
  // Match complete selectors, not the tail of a scoped rule such as
  // `.grid.no-headers .freeze-bar` when inspecting `.freeze-bar` itself.
  for (const [, selectors, declarations] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some(s => s.trim() === selector)) return declarations;
  }
  return null;
};
const px = (decl, prop) => Number(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(decl)?.[1]);

describe('the grid stylesheet', () => {
  it('gives the 14px outline buttons a 24px pointer target', () => {
    const btn = rule('.outline-btn');
    expect(px(btn, 'width')).toBe(14);
    expect(px(rule('.outline-btn::before'), 'inset')).toBe(-5);
  });

  it('gives the 10px table corner a 24px pointer target', () => {
    expect(px(rule('.table-handle'), 'width')).toBe(10);
    expect(px(rule('.table-handle::before'), 'inset')).toBe(-7);
  });

  it('draws the freeze marks and the frozen boundary in a colour that reads on the sheet', () => {
    // --ink-3 at 0.8 over the light surface is about 3.6:1, and about 4:1 over the dark one.
    const opacity = (decl) => Number(/opacity:\s*([\d.]+)/.exec(decl)?.[1]);
    for (const sel of ['.freeze-bar', '.frz-rows::after', '.frz-cols::after']) {
      const decl = rule(sel);
      expect(decl, sel).toContain('var(--ink-3)');
      expect(opacity(decl), sel).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('fades the active cell while the grid has no focus, so focusing it is visible', () => {
    const decl = rule('.grid:not(:focus-within) .sel-active');
    expect(decl).toBeTruthy();
    const opacity = Number(/opacity:\s*([\d.]+)/.exec(decl)?.[1]);
    expect(opacity).toBeGreaterThan(0.3);
    expect(opacity).toBeLessThan(0.8);
    expect(rule('.grid:focus-within .grid-corner')).toBeNull(); // no rule setting the colour it already has
  });

  it('draws the select-all triangle dark enough to be seen on the header', () => {
    const decl = rule('.grid-corner::after');
    expect(decl).toContain('var(--ink-3)');
    expect(Number(/opacity:\s*([\d.]+)/.exec(decl)[1])).toBeGreaterThanOrEqual(0.85);
  });
});
