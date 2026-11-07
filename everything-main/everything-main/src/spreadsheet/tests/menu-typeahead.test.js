// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openMenu, closeMenu, isMenuOpen } from '../src/ui/menu.js';

beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeMenu(); vi.restoreAllMocks(); document.body.replaceChildren(); });

const items = (labels) => labels.map((label) => ({ label, onSelect() {} }));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
it('matches letters typed in quick succession as a prefix', () => {
  const menu = openMenu({ x: 10, y: 10, items: items(['Paste', 'Paste special', 'Print', 'Protect', 'Zoom']) });
  const label = () => document.activeElement.textContent.trim();
  expect(label()).toBe('Paste');
  key(menu.menu, 'p');
  expect(label()).toBe('Paste special');
  key(menu.menu, 'r');
  expect(label()).toBe('Print');
  key(menu.menu, 'o');
  expect(label()).toBe('Protect');
  // A letter with no continuation falls back to cycling on that letter.
  key(menu.menu, 'z');
  expect(label()).toBe('Zoom');
});

it('cycles through items sharing a first letter when the same key is repeated slowly', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1));
  const menu = openMenu({ x: 10, y: 10, items: items(['Paste', 'Paste special', 'Print', 'Zoom']) });
  key(menu.menu, 'p');
  expect(document.activeElement.textContent.trim()).toBe('Paste special');
  vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 2));
  key(menu.menu, 'p');
  expect(document.activeElement.textContent.trim()).toBe('Print');
  vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 4));
  key(menu.menu, 'p');
  expect(document.activeElement.textContent.trim()).toBe('Paste');
  vi.useRealTimers();
});
