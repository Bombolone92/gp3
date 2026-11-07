// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

// "Fit columns to content" over the whole sheet (or whole rows) gave every
// empty column an explicit 40px width: the sheet shrank to slivers and the
// file carried a width for each of the 26 columns.
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

async function mount(prep) {
  const doc = new Doc({ name: 'Widths', path: 'Spreadsheets/Widths.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  prep(wb, id);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}
const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
async function fitColumns(selection) {
  const name = view.el.querySelector('[aria-label="Cell reference"]');
  name.value = selection;
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="format"]').click();
  menuItem('Rows and columns').click();
  menuItem('Fit columns to content').click();
  await vi.advanceTimersByTimeAsync(1);
}

it('leaves the empty columns of a whole-sheet selection at their width', async () => {
  const { wb, id } = await mount((wb, id) => { wb.setInput(id, 0, 0, 'MMMMMMMM'); wb.setInput(id, 3, 2, 'MM'); });
  wb.setColWidth(id, 4, 150); // a width somebody chose for an empty column
  wb.clearHistory();
  await fitColumns('A1:Z100');
  expect(wb.colWidth(id, 0)).toBe(70);
  expect(wb.colWidth(id, 2)).toBe(40);
  expect(wb.colWidth(id, 1)).toBe(100);
  expect(wb.colWidth(id, 4)).toBe(150);
  expect(wb.colWidth(id, 25)).toBe(100);
  expect([...wb.sheet(id).colWidths.keys()].sort((a, b) => a - b)).toEqual([0, 2, 4]);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.colWidth(id, 0)).toBe(100);
  expect(wb.colWidth(id, 2)).toBe(100);
});

it('changes nothing and says so when the selected columns hold no content', async () => {
  const { wb, id } = await mount((wb, id) => { wb.setInput(id, 0, 0, 'MMMMMMMM'); });
  wb.clearHistory();
  const notify = vi.spyOn(notifications, 'toast');
  await fitColumns('C1:E100');
  expect(wb.colWidth(id, 2)).toBe(100);
  expect(wb.colWidth(id, 4)).toBe(100);
  expect(wb.canUndo()).toBe(false);
  expect(notify.mock.calls.some(([message]) => /nothing to fit/i.test(message))).toBe(true);
});
