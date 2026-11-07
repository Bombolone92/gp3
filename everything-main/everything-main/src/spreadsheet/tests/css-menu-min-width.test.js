// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { openMenu, closeMenu } from '../src/ui/menu.js';
import { stylesheet, declared } from './helpers/css.js';

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

// A menu bar menu asks for 260px, which used to land as an inline min-width that no stylesheet
// could clamp: in a window narrower than about 283px the menu overhung the edge. The request is
// now a custom property the stylesheet caps at the viewport, as it already caps the maximum.
it('caps a menu\'s requested width at the viewport', () => {
  const css = stylesheet('components.css');
  const menu = declared(css, '.menu');
  expect(menu['min-width']).toBe('min(var(--menu-min-width, 200px), 92vw)');
  expect(menu['max-width']).toBe('min(92vw, 360px)');
  const wide = openMenu({ x: 10, y: 10, items: [{ label: 'One', onSelect() {} }], minWidth: 260 });
  expect(wide.menu.style.getPropertyValue('--menu-min-width')).toBe('260px');
  expect(wide.menu.style.minWidth).toBe('');
  closeMenu();
  const plain = openMenu({ x: 10, y: 10, items: [{ label: 'One', onSelect() {} }] });
  expect(plain.menu.style.getPropertyValue('--menu-min-width')).toBe('');
});
