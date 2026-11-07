// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeMenu(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const items = (labels) => labels.map((label) => ({ label, onSelect() {} }));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
it.each(['scrollTop', 'scrollLeft'])('ignores an already-applied opening scroll but closes on a later %s change', (axis) => {
  const scroller = document.createElement('div');
  const anchor = document.createElement('button');
  scroller.append(anchor); document.body.append(scroller);
  Object.defineProperties(scroller, { scrollHeight: { value: 500 }, clientHeight: { value: 100 }, scrollWidth: { value: 500 }, clientWidth: { value: 100 } });
  scroller[axis] = 120;
  const onClose = vi.fn();
  openMenu({ anchor, items: items(['One', 'Two']), onClose });
  scroller.dispatchEvent(new Event('scroll'));
  expect(isMenuOpen()).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  scroller[axis] = 140;
  scroller.dispatchEvent(new Event('scroll'));
  expect(isMenuOpen()).toBe(false);
  expect(onClose).toHaveBeenCalledWith('scroll');
});

it('closes when something outside it scrolls, but not when the menu itself scrolls', () => {
  const sheet = document.createElement('div');
  document.body.append(sheet);
  const menu = openMenu({ x: 100, y: 100, items: items(['One', 'Two']) });
  menu.menu.dispatchEvent(new Event('scroll', { bubbles: false }));
  expect(isMenuOpen()).toBe(true);
  sheet.dispatchEvent(new Event('scroll', { bubbles: false }));
  expect(isMenuOpen()).toBe(false);
  expect(document.querySelector('.menu')).toBeNull();
  // Once closed, later scrolls are not listened to.
  const again = openMenu({ x: 100, y: 100, items: items(['One']) });
  closeMenu();
  sheet.dispatchEvent(new Event('scroll'));
  expect(isMenuOpen()).toBe(false);
  void again;
});

it('closes an open submenu, but not the menu, when the menu itself scrolls', () => {
  const top = openMenu({ x: 100, y: 100, items: [{ label: 'More', submenu: items(['One', 'Two']) }, ...items(['Three', 'Four'])] });
  const opener = top.menu.querySelector('.menu-item');
  opener.click();
  expect(document.querySelectorAll('.menu')).toHaveLength(2);
  const sub = document.querySelectorAll('.menu')[1];
  sub.dispatchEvent(new Event('scroll')); // the submenu's own list scrolling leaves it open
  expect(document.querySelectorAll('.menu')).toHaveLength(2);
  top.menu.dispatchEvent(new Event('scroll'));
  expect(document.querySelectorAll('.menu')).toHaveLength(1);
  expect(isMenuOpen()).toBe(true);
  expect(opener.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(opener);
});
