// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// The Insert menu and the palette offer "Remove link" on a linked cell, but the flag they read
// looked at a `link` property no cell has, so the item never appeared.
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

const labels = () => [...document.querySelectorAll('.menu:not(.submenu) .menu-item .menu-label')].map((n) => n.textContent);

it('offers Remove link in the Insert menu on a linked cell, and not on a plain one', async () => {
  const doc = new Doc({ name: 'Links', path: 'Spreadsheets/Links.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setLink(id, 1, 0, 'https://x.org', 'X');
  wb.setInput(id, 2, 0, 'plain');
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A2');
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="insert"]').click();
  expect(labels()).toContain('Remove link');
  closeMenu();
  view.goTo('Sheet1!A3');
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="insert"]').click();
  expect(labels()).not.toContain('Remove link');
});
