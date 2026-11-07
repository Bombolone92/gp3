// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { isMenuOpen } from '../src/ui/menu.js';

// The column filter menu was a dead end for the keyboard: the search box swallowed every key, the
// value checkboxes ignored the arrows, and Tab closed the whole menu, so nothing but the search and
// Enter could be reached. Down, Up and Tab now move through the menu's own controls and wrap.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount() {
  const doc = new Doc({ name: 'List', path: 'Spreadsheets/List.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Amount');
  for (let r = 1; r <= 4; r++) wb.setInput(id, r, 0, String(r * 10));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 4, c2: 0 });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(isMenuOpen()).toBe(true);
  const search = document.querySelector('.menu [aria-label="Search values"]');
  expect(document.activeElement).toBe(search);
  const key = (k, init = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const checkboxes = [...document.querySelectorAll('.menu .filter-value input')];
  const menuItems = [...document.querySelectorAll('.menu [role="menuitem"]')];
  const buttons = [...document.querySelectorAll('.menu .filter-actions button')];
  return { search, key, checkboxes, menuItems, buttons, cond: document.querySelector('.menu .filter-cond') };
}

it('moves from the search box into the value list and back with the arrow keys', async () => {
  const { search, key, checkboxes, cond } = await mount();
  key('ArrowDown');
  expect(document.activeElement).toBe(checkboxes[0]);
  key('ArrowDown');
  expect(document.activeElement).toBe(checkboxes[1]);
  key('ArrowUp');
  key('ArrowUp');
  expect(document.activeElement).toBe(search);
  key('ArrowUp');
  expect(document.activeElement).toBe(cond); // the condition fields sit above the search; the hidden value boxes are skipped
  expect(isMenuOpen()).toBe(true);
});

it('keeps Tab and Shift+Tab inside the menu, wrapping from the last control to the first', async () => {
  const { search, key, checkboxes, menuItems, buttons } = await mount();
  key('Tab');
  expect(document.activeElement).toBe(checkboxes[0]);
  key('Tab', { shiftKey: true });
  expect(document.activeElement).toBe(search);
  buttons[buttons.length - 1].focus(); // Apply
  key('Tab');
  expect(document.activeElement).toBe(menuItems[0]); // Sort A to Z
  key('Tab', { shiftKey: true });
  expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  expect(isMenuOpen()).toBe(true);
});

it('reaches the first and last control with Home and End from a checkbox, and continues past the sort items with Down', async () => {
  const { key, checkboxes, menuItems, buttons } = await mount();
  checkboxes[1].focus();
  key('Home');
  expect(document.activeElement).toBe(menuItems[0]);
  key('End');
  expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  menuItems[menuItems.length - 1].focus();
  key('ArrowDown');
  expect(document.activeElement).not.toBe(menuItems[0]); // on into the menu's own controls rather than round the sort items
  expect(document.querySelector('.menu').contains(document.activeElement)).toBe(true);
  expect(isMenuOpen()).toBe(true);
});
