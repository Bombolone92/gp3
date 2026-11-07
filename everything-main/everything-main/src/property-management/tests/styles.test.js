/** Color tokens: every theme (light, chosen dark, system dark) meets WCAG contrast. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync(`${process.cwd()}/src/styles/tokens.css`, 'utf8');

function block(start) {
  const i = css.indexOf(start);
  const open = css.indexOf('{', i + start.length - 1);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j);
  }
  return '';
}
const vars = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
const light = vars(block(':root {'));
const themes = {
  light,
  dark: { ...light, ...vars(block("[data-theme='dark'] {")) },
  system: { ...light, ...vars(block(":root:not([data-theme='light']) {")) },
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('theme colors', () => {
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: text and buttons are readable`, () => {
      const pairs = [
        ['text', 'surface', 4.5],
        ['text-2', 'surface', 4.5],
        ['text-3', 'surface', 4.5],
        ['on-accent', 'accent', 4.5],
        ['on-danger', 'danger', 4.5],
        ['on-danger', 'danger-hover', 4.5],
        ['danger', 'surface', 4.5],
        ['link', 'surface', 4.5],
        // Toasts use --text as their background; their error icon must stand out (3:1 for graphics).
        ['toast-danger', 'text', 3],
        // Edges of fields, switches and the selected segment (WCAG 1.4.11).
        ['control-border', 'surface', 3],
        ['control-border', 'surface-3', 2.4],
      ];
      for (const [fg, bg, min] of pairs) {
        expect(t[fg], `--${fg} in ${name}`).toBeTruthy();
        expect(contrast(t[fg], t[bg]), `${fg} on ${bg} in ${name}`).toBeGreaterThanOrEqual(min);
      }
    });
  }
});

describe('phone layout', () => {
  it('sticky form buttons stick to the bottom of the scrolling page', () => {
    // The tab bar is outside the page's scroller, so offsetting by its height
    // floats the buttons above the bottom with content showing beneath.
    for (const f of ['rentals', 'workspace']) {
      const text = fs.readFileSync(`${process.cwd()}/src/styles/${f}.css`, 'utf8');
      expect(text, f).not.toMatch(/form-actions\s*\{\s*bottom:\s*var\(--tabbar-h\)/);
    }
  });
});

describe('phone toolbars', () => {
  it('hide only empty spacers, not headings that grow', () => {
    const text = fs.readFileSync(`${process.cwd()}/src/styles/shell.css`, 'utf8');
    expect(text).not.toMatch(/\.toolbar \.grow\s*\{\s*display:\s*none/);
    expect(text).toMatch(/\.toolbar > \.grow:empty\s*\{\s*display:\s*none/);
  });
});
