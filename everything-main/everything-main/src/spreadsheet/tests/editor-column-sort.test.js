// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { parseRange } from '../src/core/cell.js';
import * as notifications from '../src/ui/toast.js';

// Sorting with a whole column selected (the column header's menu) sorted that
// column alone, tearing the rows apart, header included. Like a spreadsheet's
// column menu it now sorts the sheet's rows by that column, keeping a header
// row in place.
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

async function mount(prep = null) {
  const doc = new Doc({ name: 'Sort', path: 'Spreadsheets/Sort.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (const [r, a, b] of [[0, 'Name', 'Qty'], [1, 'b', '2'], [2, 'a', '1'], [3, 'c', '3']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
  prep?.(wb, id);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id, toast: vi.spyOn(notifications, 'toast') };
}
async function select(text) {
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = text;
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
async function sort(label) {
  view.el.querySelector('[data-menu="data"]').click();
  menuItem('Sort').click();
  menuItem(label).click();
  await vi.advanceTimersByTimeAsync(1);
}
const column = (wb, id, c) => [0, 1, 2, 3].map((r) => wb.getValue(id, r, c));

it('sorts the rows by the selected column, keeping the header row and each row together', async () => {
  const { wb, id, toast } = await mount();
  await select('B:B');
  await sort('Sort range A to Z');
  expect(column(wb, id, 1)).toEqual(['Qty', 1, 2, 3]);
  expect(column(wb, id, 0)).toEqual(['Name', 'a', 'b', 'c']);
  expect(toast).toHaveBeenCalledWith('Sorted A to Z');
});

it('keeps a text header above a text column in place', async () => {
  const { wb, id } = await mount();
  await select('A:A');
  await sort('Sort range Z to A');
  expect(column(wb, id, 0)).toEqual(['Name', 'c', 'b', 'a']);
  expect(column(wb, id, 1)).toEqual(['Qty', 3, 2, 1]);
});

it('says why a sort was refused instead of reporting a sort that did not happen', async () => {
  const { wb, id, toast } = await mount((wb, id) => wb.mergeCells(id, parseRange('A2:B2')));
  await select('B:B');
  await sort('Sort range A to Z');
  expect(column(wb, id, 0)).toEqual(['Name', 'b', 'a', 'c']);
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Can.t sort/), expect.objectContaining({ icon: 'info' }));
  expect(toast).not.toHaveBeenCalledWith('Sorted A to Z');
});
