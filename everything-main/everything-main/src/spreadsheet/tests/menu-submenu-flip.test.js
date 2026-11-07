// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeMenu(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const items = (labels) => labels.map((label) => ({ label, onSelect() {} }));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
it('opens a submenu to the left when it would not fit to the right of its parent', () => {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1280 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.classList.contains('menu') ? 260 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('menu') ? 200 : 32; } });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const menu = this.closest?.('.menu');
    if (!menu) return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
    const left = parseFloat(menu.style.left) || 0;
    const top = (parseFloat(menu.style.top) || 0) + 40;
    return { left, top, width: 260, height: 32, right: left + 260, bottom: top + 32 };
  });
  const parentMenu = openMenu({ x: 1200, y: 100, items: [{ label: 'More', submenu: items(['One', 'Two']) }] });
  const parentLeft = parseFloat(parentMenu.menu.style.left);
  expect(parentLeft).toBe(1280 - 8 - 260);
  parentMenu.menu.querySelector('.menu-item').click();
  const sub = document.querySelector('.menu.submenu');
  expect(parseFloat(sub.style.left) + 260).toBeLessThanOrEqual(parentLeft);
  // With room on the right the submenu still opens there.
  closeMenu();
  const wide = openMenu({ x: 100, y: 100, items: [{ label: 'More', submenu: items(['One', 'Two']) }] });
  wide.menu.querySelector('.menu-item').click();
  expect(parseFloat(document.querySelector('.menu.submenu').style.left)).toBeGreaterThanOrEqual(100 + 260);
});
