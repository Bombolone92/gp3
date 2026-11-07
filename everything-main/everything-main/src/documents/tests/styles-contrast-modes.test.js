import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (name) => readFileSync(new URL(`../src/styles/${name}`, import.meta.url), 'utf8');

describe('forced-colors and swatch styles', () => {
  it('outlines pressed, chosen and open states where system colors drop backgrounds and shadows', () => {
    const base = css('base.css');
    const block = base.slice(base.indexOf('@media (forced-colors: active)'));
    expect(block).toContain('.tb-btn[aria-pressed="true"]');
    expect(block).toContain('.segmented button[aria-checked="true"]');
    expect(block).toMatch(/outline: 2px solid Highlight/);
    expect(block).toMatch(/\.swatch[^{]*\{ forced-color-adjust: none/);
    expect(block).toMatch(/\.swatch:focus-visible \{ outline: 2px solid Highlight/);
  });

  it('gives color swatches an edge that shows against white and black colors', () => {
    expect(css('components.css')).toMatch(/\.swatch \{[^}]*border: 1px solid var\(--control-border\)/);
  });
});

describe('selection, scrolling and print', () => {
  const tokens = css('tokens.css');
  const hex = (name, block) => block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  const luminance = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => { const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };

  it('marks selected text in the app\'s fields with an opaque tint that shows against the surface, in both themes', () => {
    const light = tokens.slice(0, tokens.indexOf('@media'));
    const dark = tokens.slice(tokens.indexOf('[data-theme="dark"]'));
    expect(css('base.css')).toMatch(/::selection \{\s*background: var\(--selection\);\s*color: var\(--ink\);/);
    for (const block of [light, dark]) {
      const selection = hex('--selection', block), surface = hex('--surface', block), ink = hex('--ink', block);
      expect(selection).toBeTruthy();
      // Visible as a highlight against the field, and the text on it still readable.
      expect(contrast(selection, surface)).toBeGreaterThan(1.5);
      expect(contrast(ink, selection)).toBeGreaterThan(4.5);
    }
  });

  it('keeps a scrolling menu or dialog from scrolling the page behind it, which would close the menu', () => {
    const components = css('components.css');
    expect(components).toMatch(/\.menu \{[^}]*overscroll-behavior: contain/);
    expect(components).toMatch(/\.modal-panel \{[^}]*overscroll-behavior: contain/);
  });

  it('prints dark text on white paper from the browser\'s own print, whatever the theme', () => {
    const base = css('base.css');
    const print = base.slice(base.indexOf('@media print'));
    expect(print).toMatch(/:root\[data-page="dark"\][^}]*--paper: #fff/);
    expect(print).toMatch(/--paper-ink: #111/);
  });

  it('keeps progress spinners turning under reduced motion instead of freezing them on one frame', () => {
    const base = css('base.css');
    const motion = base.slice(base.indexOf('@media (prefers-reduced-motion: reduce)'), base.indexOf('@media (prefers-reduced-motion: reduce)') + 600);
    expect(motion).toMatch(/\.spin svg \{ animation: spin [^}]*infinite !important/);
  });

  it('wraps long unbroken names in dialog prose and errors', () => {
    expect(css('components.css')).toMatch(/\.modal-text, \.field-error, \.field-hint, \.menu-note \{ overflow-wrap: anywhere/);
  });
});

describe('layering', () => {
  it('keeps menus above toasts, so a toast cannot cover a menu\'s last items', () => {
    const components = css('components.css');
    const menu = Number(components.match(/\.menu \{[^}]*z-index: (\d+)/)[1]);
    const toast = Number(components.match(/\.toast-root \{[^}]*z-index: (\d+)/)[1]);
    const modal = Number(components.match(/\.modal-root \{[^}]*z-index: (\d+)/)[1]);
    expect(menu).toBeGreaterThan(toast);
    expect(toast).toBeGreaterThan(modal);
  });
});

describe('toolbar on a notched phone', () => {
  it('keeps the first divider clipped by taking the left inset as a border rather than padding', () => {
    const editor = css('editor.css');
    const toolbarRules = [...editor.matchAll(/\.toolbar \{([^}]*)\}/g)].map((m) => m[1]);
    expect(toolbarRules.some((rule) => rule.includes('border-left: var(--safe-l) solid transparent'))).toBe(true);
    expect(toolbarRules.some((rule) => /padding:[^;]*--safe-l/.test(rule))).toBe(false);
    expect(editor).toMatch(/\.tb-rows \{[^}]*margin-left: -14px/);
  });
});
