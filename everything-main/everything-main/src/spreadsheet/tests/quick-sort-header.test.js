// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// The quick sort from a single cell kept a header row in place only when the
// sorted column held text over numbers, so sorting a text column moved "Name"
// in among the names. The block around the cell is now read for a header the way
// the sort dialog reads it; an explicit selection keeps its first row only when
// a text row sits over typed values, so a plain list of names still sorts whole.
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

async function mount(rows) {
  const doc = new Doc({ name: 'Sort', path: 'Spreadsheets/Sort.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  rows.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, column: (c) => rows.map((_, r) => wb.getValue(id, r, c)) };
}
async function select(text) {
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = text;
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
async function sortAZ() {
  view.el.querySelector('[data-menu="data"]').click();
  menuItem('Sort').click();
  menuItem('Sort range A to Z').click();
  await vi.advanceTimersByTimeAsync(1);
}

it('keeps the header row in place when sorting a text column from one of its cells', async () => {
  const { column } = await mount([['Name', 'Qty'], ['b', 2], ['a', 1], ['c', 3]]);
  await select('A2');
  await sortAZ();
  expect(column(0)).toEqual(['Name', 'a', 'b', 'c']);
  expect(column(1)).toEqual(['Qty', 1, 2, 3]);
});

it('keeps a text header over text data in place when sorting from one cell of the block', async () => {
  const { column } = await mount([['Name', 'City'], ['b', 'y'], ['a', 'x']]);
  await select('A3');
  await sortAZ();
  expect(column(0)).toEqual(['Name', 'a', 'b']);
  expect(column(1)).toEqual(['City', 'x', 'y']);
});

it('keeps the header of an explicit selection whose text row sits over typed values', async () => {
  const { column } = await mount([['Name', 'Qty'], ['b', 2], ['a', 1], ['c', 3]]);
  await select('A1:B4');
  await sortAZ();
  expect(column(0)).toEqual(['Name', 'a', 'b', 'c']);
  expect(column(1)).toEqual(['Qty', 1, 2, 3]);
});

it('sorts an explicitly selected list of text whole, its first entry included', async () => {
  const { column } = await mount([['b'], ['c'], ['a']]);
  await select('A1:A3');
  await sortAZ();
  expect(column(0)).toEqual(['a', 'b', 'c']);
});
