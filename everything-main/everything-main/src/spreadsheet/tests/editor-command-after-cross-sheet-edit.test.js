// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// With a formula open, Ctrl/Cmd+PgDn shows another sheet to pick references on. A menu command run
// there commits the formula first, which brings the grid home to the formula's sheet; but the command
// had read the sheet before the commit, so it inserted rows into, or sorted, the sheet just left, at
// the rows selected on the home sheet. The sheet is now read after the commit, as the selection is.
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

const column = (wb, id, c, n) => Array.from({ length: n }, (_, r) => wb.getValue(id, r, c));
const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

/** Sheet1 (home) and Sheet2 (other), each with a column of data, the editor on Sheet1 at `cell`. */
async function setup(cell, { home: homeCells, other: otherCells }) {
  const doc = new Doc({ name: 'Sheets', path: 'Spreadsheets/Sheets.xlsx' });
  const wb = doc.wb;
  const home = wb.activeSheetId;
  const other = wb.addSheet('Sheet2').id;
  wb.setActiveSheet(home);
  for (const [r, c, text] of homeCells) wb.setInput(home, r, c, text);
  for (const [r, c, text] of otherCells) wb.setInput(other, r, c, text);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${cell}`);
  await vi.advanceTimersByTimeAsync(1);
  const toast = vi.spyOn(notifications, 'toast');
  return { wb, home, other, toast };
}

/** Start typing `text` into the active cell and leave the editor open. */
async function type(text) {
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: text[0], bubbles: true, cancelable: true }));
  const editor = view.el.querySelector('.grid-editor');
  editor.value = text;
  editor.setSelectionRange(text.length, text.length);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  return editor;
}

/** Type an open formula and press Ctrl+PgDn: the next sheet is shown with the edit still alive. */
async function typeFormulaOnOtherSheet(wb, other) {
  const editor = await type('=SUM(');
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.activeSheetId).toBe(other);
  expect(editor.hidden).toBe(false);
}

async function menu(...path) {
  view.el.querySelector(`[data-menu="${path[0]}"]`).click();
  for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
}

const numbers = (rows, c) => rows.map((v, r) => [r, c, String(v)]);

it('inserts the row on the sheet the formula was typed on, not on the sheet it was shown on', async () => {
  const { wb, home, other } = await setup('A4', {
    home: [[0, 0, '1'], [1, 0, '2'], [2, 0, '3'], [4, 0, '5'], [5, 0, '6']],
    other: numbers(['a', 'b', 'c', 'd', 'e', 'f'], 1),
  });
  await typeFormulaOnOtherSheet(wb, other);
  await menu('insert', 'Rows and columns', 'Row above');
  // The formula was committed to Sheet1!A4 and the grid came home; the new row went in above it there.
  expect(wb.activeSheetId).toBe(home);
  expect(wb.getCell(home, 4, 0)?.f).toBe('SUM()');
  expect(column(wb, home, 0, 7).filter((_, r) => r !== 4)).toEqual([1, 2, 3, null, 5, 6]);
  // Sheet2 was not touched: no blank row at its row 4.
  expect(column(wb, other, 1, 7)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', null]);
});

it('sorts the range on the sheet the formula was typed on, not the same rows of the sheet it was shown on', async () => {
  const { wb, home, other, toast } = await setup('B1:B5', {
    home: [[1, 1, '4'], [2, 1, '2'], [3, 1, '3'], [4, 1, '1']],
    other: numbers([9, 8, 7, 6, 5], 1),
  });
  await typeFormulaOnOtherSheet(wb, other);
  await menu('data', 'Sort', 'Sort range A to Z');
  expect(toast).toHaveBeenCalledWith('Sorted A to Z');
  expect(wb.activeSheetId).toBe(home);
  // Sheet1!B1:B5 (the committed formula among them) is in order; Sheet2!B1:B5 is as it was.
  const sorted = column(wb, home, 1, 5);
  const formulaRow = [0, 1, 2, 3, 4].find((r) => wb.getCell(home, r, 1)?.f != null);
  expect(formulaRow).not.toBeUndefined();
  expect(sorted.filter((_, r) => r !== formulaRow)).toEqual([1, 2, 3, 4]);
  expect(column(wb, other, 1, 5)).toEqual([9, 8, 7, 6, 5]);
});

it('still commits a plain entry and inserts the row on its own sheet when no other sheet was shown', async () => {
  const { wb, home, other } = await setup('A4', {
    home: [[0, 0, '1'], [1, 0, '2'], [2, 0, '3']],
    other: numbers(['a', 'b', 'c'], 1),
  });
  await type('hello');
  await menu('insert', 'Rows and columns', 'Row above');
  expect(wb.activeSheetId).toBe(home);
  expect(column(wb, home, 0, 6)).toEqual([1, 2, 3, null, 'hello', null]);
  expect(column(wb, other, 1, 4)).toEqual(['a', 'b', 'c', null]);
  // One undo takes the row out and leaves the entry, as before.
  wb.undo();
  expect(column(wb, home, 0, 5)).toEqual([1, 2, 3, 'hello', null]);
});

it('inserts the row where the selection is when nothing is being edited', async () => {
  const { wb, home, other } = await setup('A2', {
    home: [[0, 0, '1'], [1, 0, '2'], [2, 0, '3']],
    other: numbers(['a', 'b', 'c'], 1),
  });
  await menu('insert', 'Rows and columns', 'Row above');
  expect(column(wb, home, 0, 5)).toEqual([1, null, 2, 3, null]);
  expect(column(wb, other, 1, 4)).toEqual(['a', 'b', 'c', null]);
});
