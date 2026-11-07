// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// The workbook declines to merge a block past its size limit, or one over a
// table's header and data cells. The editor announced "Merged" regardless.
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
  const doc = new Doc({ name: 'Merge', path: 'Spreadsheets/Merge.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  const messages = () => toast.mock.calls.map(([m]) => m);
  return { wb, id, messages };
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
const merge = async (item) => {
  view.el.querySelector('[data-menu="format"]').click();
  menuItem('Merge cells').click();
  menuItem(item).click();
  await vi.advanceTimersByTimeAsync(1);
};

it('names the size limit instead of saying Merged when the block is too large to merge', async () => {
  const { wb, id, messages } = await mount();
  wb.setInput(id, 1, 0, 'kept?');
  view.goTo('Sheet1!A1:B10001');
  await merge('Merge and center');
  expect(wb.sheet(id).merges).toEqual([]);
  expect(wb.getValue(id, 1, 0)).toBe('kept?');
  expect(messages()).toEqual(['Select at most 20,000 cells to merge at once']);
});

it('says a table cannot be merged instead of Merged when every row of the block lies in one', async () => {
  const { wb, id, messages } = await mount();
  for (let r = 0; r < 3; r++) { wb.setInput(id, r, 0, `a${r}`); wb.setInput(id, r, 1, `b${r}`); }
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'T' });
  view.goTo('Sheet1!A1:B3');
  await merge('Merge horizontally');
  expect(wb.sheet(id).merges).toEqual([]);
  expect(wb.getValue(id, 0, 1)).toBe('b0');
  expect(messages()).toEqual(['The header and data cells of a table cannot be merged']);
});

it('still reports a merge that went through', async () => {
  const { wb, id, messages } = await mount();
  wb.setInput(id, 0, 0, 'top');
  wb.setInput(id, 0, 1, 'lost');
  view.goTo('Sheet1!A1:B2');
  await merge('Merge and center');
  expect(wb.sheet(id).merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
  expect(messages()).toEqual(['Merged. Only the top-left value was kept (1 cleared)']);
});
