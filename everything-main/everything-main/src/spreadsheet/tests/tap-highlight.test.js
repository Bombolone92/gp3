import { expect, it } from 'vitest';
import { stylesheet, declared } from './helpers/css.js';

// iOS flashes a grey box over whatever is tapped. Buttons had it turned off, but the sheet tabs
// (divs with role tab), the grid, header cells, the home page's file links and the filter and
// find checkboxes' labels all still flashed. The property inherits, so the body turns it off
// once for the app and for the menus and toasts appended beside it.
it('turns the iOS tap highlight off for the whole document, not only buttons', () => {
  const css = stylesheet('base.css');
  expect(declared(css, 'body')['-webkit-tap-highlight-color']).toBe('transparent');
  expect(declared(css, 'button')['-webkit-tap-highlight-color']).toBeUndefined();
});
