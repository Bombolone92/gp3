// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as notifications from '../src/ui/toast.js';

// The grid draws no frozen pane that would fill most of the window, but the toast reported the
// count the sheet stored: "Frozen 12 rows" while nothing froze and nothing said why.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

// 12 default rows are 12 * ROW = 240px on screen: more than 70% of this window.
const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const VIEW_H = 300;

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => VIEW_H });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount() {
  const doc = new Doc({ name: 'Freeze', path: 'Spreadsheets/Freeze.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
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
async function freeze(label) {
  view.el.querySelector('[data-menu="view"]').click();
  menuItem('Freeze').click();
  menuItem(label).click();
  await vi.advanceTimersByTimeAsync(1);
}

it('says the rows are not frozen, and why, when the pane would fill most of the window', async () => {
  expect(12 * ROW).toBeGreaterThan(VIEW_H * 0.7); // the premise: 12 rows fill most of the window
  const { wb, id, toast } = await mount();
  await select('A12');
  await freeze('Rows up to the selection');
  expect(wb.sheet(id).frozenRows).toBe(12);
  expect(view.el.querySelector('.frz-rows').hidden).toBe(true);
  expect(toast).toHaveBeenCalledWith('12 rows would fill most of the window, so they are not frozen', expect.anything());
});

it('reports what did freeze beside what did not', async () => {
  const { wb, id, toast } = await mount();
  await select('C12');
  await freeze('Columns up to the selection');
  expect(toast).toHaveBeenCalledWith('Frozen 3 columns', expect.anything());
  await freeze('Rows up to the selection');
  expect(wb.sheet(id).frozenCols).toBe(3);
  expect(view.el.querySelector('.frz-cols').hidden).toBe(false);
  expect(view.el.querySelector('.frz-rows').hidden).toBe(true);
  expect(toast).toHaveBeenCalledWith('Frozen 3 columns. 12 rows would fill most of the window, so they are not frozen', expect.anything());
});
