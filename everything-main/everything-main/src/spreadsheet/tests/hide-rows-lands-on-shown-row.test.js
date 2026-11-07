// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// After hiding rows the selection lands on the next visible row; the search for it knew only the rows
// hidden by hand, so it could land on a row a filter hides and leave the active cell invisible.
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

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

it('lands on the next row the filter shows, not on one it hides', async () => {
  const doc = new Doc({ name: 'Filtered', path: 'Spreadsheets/Filtered.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  // Rows 3 and 4 (1-based) are hidden by the filter; row 5 is the first shown row after row 2.
  [['Key'], ['a'], ['b'], ['b'], ['a'], ['a']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 5, c2: 0 });
  wb.setFilterCriteria(id, 0, { formula: 'A2="a"' });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 3]);
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A2');
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="view"]').click();
  item('Hide and unhide').click();
  await vi.advanceTimersByTimeAsync(1);
  item('Hide rows').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(id).hiddenRows.has(1)).toBe(true);
  expect(view.el.querySelector('.name-box').value).toBe('A5');
});
