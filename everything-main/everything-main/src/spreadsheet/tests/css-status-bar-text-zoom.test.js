import { expect, it } from 'vitest';
import { stylesheet, declared, themeTokens } from './helpers/css.js';

const px = (v) => parseFloat(v);
const base = stylesheet('base.css');
const editor = stylesheet('editor.css');

// The status bar was a fixed 28px. At 200% text-only zoom (Firefox's "Zoom text only", a user
// stylesheet, or an OS minimum font size) its 12px line box is 34.8px, and both halves carry
// overflow: hidden, so the sums, the count and the error explanation lost their ascenders and
// descenders. WCAG 1.4.4 in its strict reading; page zoom was never affected.
it('lets the status bar grow past its token height for text that no longer fits', () => {
  const bar = declared(editor, '.status-bar');
  const token = px(themeTokens('light')['statusbar-h']);
  const lineHeight = px(declared(base, 'body')['line-height']);
  expect(bar.height).toBeUndefined();
  expect(bar['min-height']).toBe('calc(var(--statusbar-h) + var(--safe-b))');
  // At 100% the bar sits exactly at its token height; at 200% the text alone is taller than that.
  expect(px(bar['font-size']) * lineHeight).toBeLessThanOrEqual(token);
  expect(px(bar['font-size']) * 2 * lineHeight).toBeGreaterThan(token);
  // The bars that were given room first, for comparison.
  expect(declared(editor, '.toolbar', 'pointer: fine')['min-height']).toBe('var(--toolbar-h)');
  expect(declared(editor, '.menubar', 'pointer: fine')['min-height']).toBe('var(--menubar-h)');
});
