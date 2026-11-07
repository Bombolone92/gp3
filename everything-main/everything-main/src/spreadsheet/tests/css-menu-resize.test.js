// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeMenu(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const items = (labels) => labels.map((label) => ({ label, onSelect() {} }));
const resize = () => window.dispatchEvent(new Event('resize'));

// With interactive-widget=resizes-content the on-screen keyboard shrinks the window, and every
// menu closed on resize: on a phone, tapping the filter menu's search field dismissed the menu
// and the keyboard together. A menu that holds focus stays and moves into the visible room.
it('stays open when the window resizes while a field inside it has focus', () => {
  const field = document.createElement('input');
  const menu = openMenu({ x: 100, y: 100, items: [{ custom: field }, ...items(['Apply'])] });
  field.focus();
  expect(document.activeElement).toBe(field);
  resize();
  expect(isMenuOpen()).toBe(true);
  expect(document.querySelector('.menu')).toBe(menu.menu);
  expect(document.activeElement).toBe(field);
});

it('moves back into view on that resize and lets a clamped height grow again', () => {
  const menu = openMenu({ x: 100, y: 100, items: items(['One', 'Two']) });
  expect(document.activeElement.textContent).toBe('One');
  expect(menu.menu.style.top).toBe('100px');
  menu.menu.style.maxHeight = '120px';
  menu.menu.style.overflowY = 'auto';
  const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(50);
  resize();
  expect(isMenuOpen()).toBe(true);
  expect(menu.menu.style.top).toBe('42px'); // 8px above the new bottom edge
  height.mockReturnValue(768);
  resize();
  expect(menu.menu.style.top).toBe('100px');
  expect(menu.menu.style.maxHeight).toBe('');
  expect(menu.menu.style.overflowY).toBe('');
});

it('still closes on a resize when focus is elsewhere, and stops listening once closed', () => {
  openMenu({ x: 100, y: 100, items: items(['One']) });
  document.activeElement.blur();
  resize();
  expect(isMenuOpen()).toBe(false);
  expect(document.querySelector('.menu')).toBeNull();
  const again = openMenu({ x: 100, y: 100, items: items(['One']) });
  closeMenu();
  resize();
  expect(isMenuOpen()).toBe(false);
  void again;
});
