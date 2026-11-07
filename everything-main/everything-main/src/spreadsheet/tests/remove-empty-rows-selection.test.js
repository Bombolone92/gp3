// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// After Remove empty rows the selection shrank to the rows left, but the active
// cell stayed where it was, outside the selection when it had sat near the
// bottom. The active cell now moves up into the rows that remain.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('moves the active cell up into the rows that remain', async () => {
  const doc = new Doc({ name: 'Empty', path: 'Spreadsheets/Empty.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (const [r, v] of [[0, 'a'], [2, 'b'], [5, 'c']]) wb.setInput(id, r, 0, v);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  // A6 is selected first and the selection grown upward, so the active cell is A6 at the bottom of A1:A6.
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = 'A6';
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  for (let i = 0; i < 5; i++) viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(name.value).toBe('A1:A6');
  expect(viewport.getAttribute('aria-activedescendant')).toBe('gc-5-0');
  const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
  view.el.querySelector('[data-menu="data"]').click();
  menuItem('Data cleanup').click();
  menuItem('Remove empty rows').click();
  await vi.advanceTimersByTimeAsync(1);
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(['a', 'b', 'c']);
  expect(name.value).toBe('A1:A3');
  // The active cell, which the grid names for assistive technology, sits on the last row left rather than on A6.
  expect(viewport.getAttribute('aria-activedescendant')).toBe('gc-2-0');
  expect(document.activeElement).toBe(viewport);
});
