import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

const css = stylesheet('editor.css');
const px = (v) => parseFloat(v);

// The zoom buttons in the status bar were 22px square and the percentage button 21px tall:
// under the 24px minimum a pointer target needs (WCAG 2.5.8). The 28px bar has room for 24.
it('gives the zoom out, zoom in and zoom level buttons a 24px target', () => {
  const btn = declared(css, '.zoom-btn');
  expect(px(btn.width)).toBeGreaterThanOrEqual(24);
  expect(px(btn.height)).toBeGreaterThanOrEqual(24);
  const label = declared(css, '.zoom-label');
  expect(px(label['min-height'])).toBeGreaterThanOrEqual(24);
  expect(px(label['min-width'])).toBeGreaterThanOrEqual(24);
  // Still inside the status bar.
  const barHeight = px(declared(stylesheet('tokens.css'), ':root', false)['--statusbar-h']);
  expect(px(btn.height)).toBeLessThanOrEqual(barHeight);
  expect(px(label['min-height'])).toBeLessThanOrEqual(barHeight);
});
