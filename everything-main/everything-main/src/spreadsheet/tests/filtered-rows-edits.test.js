// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
const canvas = { font: '', measureText: (text) => ({ width: text.length * 7 }) };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Element.prototype.setPointerCapture = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvas);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  view?.destroy();
  view = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** A filtered list: column A keeps only "a" rows, hiding rows 3 and 5 (1-based). */
async function open() {
  const doc = new Doc({ name: 'Filtered', path: 'Spreadsheets/Filtered.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  [['Key', 'Value'], ['a', '1'], ['b', '2'], ['a', '3'], ['b', '4'], ['a', '5']].forEach((row, r) => row.forEach((t, c) => wb.setInput(id, r, c, t)));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 5, c2: 1 });
  wb.setFilterCriteria(id, 0, { formula: 'A2="a"' });
  expect([...wb.sheet(id).filterHidden].sort()).toEqual([2, 4]);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!B2:B6');
  await vi.advanceTimersByTimeAsync(1);
  const item = (label) => [...document.querySelectorAll('.menu-item')].find((node) => node.querySelector('.menu-label')?.textContent === label);
  const column = () => [1, 2, 3, 4, 5].map((r) => wb.getValue(id, r, 1));
  return { wb, id, item, column };
}

it('clears only the rows a filter shows', async () => {
  const { wb, id, column } = await open();
  view.el.querySelector('.grid-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  expect(column()).toEqual([null, 2, null, 4, null]);
  wb.undo();
  expect(column()).toEqual([1, 2, 3, 4, 5]);
});

it('formats only the rows a filter shows', async () => {
  const { wb, id, item } = await open();
  view.el.querySelector('[data-menu="format"]').click();
  item('Text').click();
  await vi.advanceTimersByTimeAsync(1);
  item('Bold').click();
  expect([1, 2, 3, 4, 5].map((r) => !!wb.getCell(id, r, 1)?.s?.bold)).toEqual([true, false, true, false, true]);
});

it('deletes only the rows a filter shows and keeps the hidden ones', async () => {
  const { wb, id, item, column } = await open();
  view.el.querySelector('[data-menu="edit"]').click();
  item('Delete').click();
  await vi.advanceTimersByTimeAsync(1);
  item('Rows').click();
  await vi.advanceTimersByTimeAsync(1);
  expect([1, 2].map((r) => [wb.getValue(id, r, 0), wb.getValue(id, r, 1)])).toEqual([['b', 2], ['b', 4]]);
  expect(wb.getValue(id, 3, 0)).toBe(null);
  expect(wb.undoLabels()).toHaveLength(1);
});
