// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Paste special > Column widths only read the widths from the copied cells' sheet by id, so
// after that sheet was deleted it pasted the default width over the destination's columns, in
// silence, while the Links paste beside it says "The copied cells' sheet is gone". So does this now.
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

async function menu(...path) {
  view.el.querySelector(`[data-menu="${path[0]}"]`).click();
  for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
}

it("refuses to paste column widths once the copied cells' sheet is gone, as the Links paste does", async () => {
  const doc = new Doc({ name: 'Widths', path: 'Spreadsheets/Widths.xlsx' });
  const wb = doc.wb;
  const home = wb.activeSheetId;
  const other = wb.addSheet('Sheet2').id;
  wb.setInput(other, 0, 0, 'a');
  wb.setInput(other, 0, 1, 'b');
  wb.setColWidth(other, 0, 222);
  wb.setColWidth(other, 1, 333);
  wb.setColWidth(home, 3, 150);
  wb.setColWidth(home, 4, 160);
  wb.setActiveSheet(other);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet2!A1:B1');
  await vi.advanceTimersByTimeAsync(1);
  await menu('edit', 'Copy');
  await vi.advanceTimersByTimeAsync(1);
  wb.deleteSheet(other);
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.activeSheetId).toBe(home);
  view.goTo('Sheet1!D1');
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  await menu('edit', 'Paste special', 'Column widths only');
  await vi.advanceTimersByTimeAsync(1500);
  expect(wb.colWidth(home, 3)).toBe(150);
  expect(wb.colWidth(home, 4)).toBe(160);
  expect(toast).toHaveBeenCalledWith("The copied cells' sheet is gone", expect.anything());
  expect(wb.undoLabels()).not.toContain('Paste column widths');
});

it('still pastes the widths while the copied sheet is there', async () => {
  const doc = new Doc({ name: 'Widths', path: 'Spreadsheets/Widths.xlsx' });
  const wb = doc.wb;
  const home = wb.activeSheetId;
  const other = wb.addSheet('Sheet2').id;
  wb.setInput(other, 0, 0, 'a');
  wb.setColWidth(other, 0, 222);
  wb.setColWidth(other, 1, 333);
  wb.setActiveSheet(other);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet2!A1:B1');
  await vi.advanceTimersByTimeAsync(1);
  await menu('edit', 'Copy');
  view.goTo('Sheet1!D1');
  await vi.advanceTimersByTimeAsync(1);
  await menu('edit', 'Paste special', 'Column widths only');
  await vi.advanceTimersByTimeAsync(1500);
  expect([wb.colWidth(home, 3), wb.colWidth(home, 4)]).toEqual([222, 333]);
  expect(wb.undoLabels()).toEqual(['Paste column widths']);
});
