import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

// The fill handle is 9px with a 5px hit margin: 19px, under the 24px a finger needs (WCAG 2.5.8),
// and on a touch screen it is the only way to drag a range out.
it('gives the fill handle a 24px target under a coarse pointer without growing it on screen', () => {
  const css = stylesheet('grid.css');
  expect(declared(css, '.fill-handle', false).width).toBe('9px');
  expect(declared(css, '.fill-handle::after', false).inset).toBe('-5px');
  expect(declared(css, '.fill-handle::after', 'pointer: coarse').inset).toBe('-8px'); // 9 + 2 × 8 = 25px
});
