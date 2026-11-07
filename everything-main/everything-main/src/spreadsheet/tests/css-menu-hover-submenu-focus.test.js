// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; vi.useFakeTimers(); });
afterEach(() => { closeMenu(); vi.useRealTimers(); document.body.replaceChildren(); });

const key = (k) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const menus = () => document.querySelectorAll('.menu').length;
const hover = (btn) => { btn.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(150); };
function open() {
  openMenu({ x: 10, y: 10, items: [
    { label: 'Paste', onSelect() {} },
    { label: 'Paste special', submenu: [{ label: 'Values only', onSelect() {} }, { label: 'Formats only', onSelect() {} }] },
    { label: 'Clear', onSelect() {} },
  ] });
  return [...document.querySelectorAll('.menu-item')];
}

// Resting the pointer on "Paste special" opened its submenu and moved keyboard focus into it, so an
// ArrowDown meant for the menu under the keyboard walked the submenu instead.
it('leaves focus in the parent menu when the pointer opens a submenu', () => {
  const [paste, special] = open();
  expect(document.activeElement).toBe(paste);
  hover(special);
  expect(menus()).toBe(2);
  expect(document.activeElement).toBe(paste);
  key('ArrowDown');
  expect(document.activeElement).toBe(special);
  expect(menus()).toBe(1); // the keyboard moved on: the pointer's submenu is stale
});

it('moves focus into a submenu the keyboard opens, even one the pointer opened first', () => {
  const [, special] = open();
  special.focus();
  hover(special);
  expect(menus()).toBe(2);
  expect(document.activeElement).toBe(special);
  key('ArrowRight');
  expect(menus()).toBe(2);
  expect(document.activeElement.textContent).toContain('Values only');
  key('Escape');
  expect(menus()).toBe(1);
  expect(document.activeElement).toBe(special);
});

it('peels a pointer-opened submenu on Escape before closing the menu itself', () => {
  const [, special] = open();
  special.focus();
  hover(special);
  expect(menus()).toBe(2);
  key('Escape');
  expect(menus()).toBe(1);
  expect(document.activeElement).toBe(special);
  key('Escape');
  expect(isMenuOpen()).toBe(false);
});

it('still moves focus into a submenu opened by a click', () => {
  const [, special] = open();
  special.click();
  expect(menus()).toBe(2);
  expect(document.activeElement.textContent).toContain('Values only');
});

// A menu bar that swaps menus with the arrow keys opens each through openMenu while focus is
// still in the previous menu; it names the title focus should return to.
it('returns focus to the opener the caller names rather than what had focus', () => {
  const first = document.createElement('button');
  const second = document.createElement('button');
  document.body.append(first, second);
  first.focus();
  openMenu({ anchor: second, opener: second, items: [{ label: 'One', onSelect() {} }] });
  closeMenu();
  expect(document.activeElement).toBe(second);
});
