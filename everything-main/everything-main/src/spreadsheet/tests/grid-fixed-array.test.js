// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { createFormulaBar } from '../src/ui/formulabar.js';
import { Workbook } from '../src/core/workbook.js';
import { fromRange, single } from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
});
const cleanup = [];
afterEach(() => { for (const destroy of cleanup.splice(0)) destroy(); document.body.replaceChildren(); });
const range = { r1: 2, c1: 3, r2: 4, c2: 4 };
function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  const messages = [];
  const grid = createGrid({ wb, sheetId: id, announce: text => messages.push(text) });
  const bar = createFormulaBar({ wb, grid, sheetId: () => id,
    activeCell: () => wb.getCell(id, grid.active.r, grid.active.c), subscribe: () => () => {}, run() {}, announce() {} });
  document.body.replaceChildren(grid.el, bar.el);
  cleanup.push(() => { bar.destroy(); grid.destroy(); });
  return { wb, id, grid, bar, messages, input: bar.el.querySelector('.formula-input') };
}

it('enters a selected fixed array with Ctrl+Shift+Enter and one undo step', () => {
  const { wb, id, grid } = setup();
  grid.setSelection(fromRange(range));
  grid.beginEdit({ text: '=ROW()+COLUMN()' });
  grid.handleEditKey(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true }));
  expect(grid.editing).toBe(false);
  expect(wb.getCell(id, 2, 3).array).toEqual({ rows: 3, cols: 2 });
  expect(wb.getValue(id, 4, 4)).toBe(10);
  expect(wb.undoLabels()).toEqual(['Edit array formula']);
});

it('shows the array formula from any output cell and requires the full selection to edit it', () => {
  const { wb, id, grid, bar, input } = setup();
  wb.setArrayFormula(id, range, '=ROW()+COLUMN()');
  grid.setSelection(single(3, 4));
  bar.refresh();
  expect(input.value).toBe('{=ROW()+COLUMN()}');
  expect(grid.beginEdit()).toBeNull();
  expect(grid.editing).toBe(false);
  grid.setSelection(fromRange(range, { r: 3, c: 4 }));
  input.focus();
  expect(grid.editState).toMatchObject({ r: 2, c: 3, text: '=ROW()+COLUMN()' });
  grid.setEditText('=2+3');
  expect(grid.commitEdit()).toBe(true);
  expect(wb.rangeValues(id, range)).toEqual([[5, 5], [5, 5], [5, 5]]);
});

it('keeps an invalid full-array edit open and leaves its values intact', () => {
  const { wb, id, grid } = setup();
  wb.setArrayFormula(id, range, '=2+3');
  wb.clearHistory();
  grid.setSelection(fromRange(range));
  grid.beginEdit({ text: 'replacement' });
  expect(grid.commitEdit()).toBe(false);
  expect(grid.editing).toBe(true);
  expect(wb.getValue(id, 4, 4)).toBe(5);
  expect(wb.canUndo()).toBe(false);
  grid.setEditText('=2+3');
  expect(grid.commitEdit()).toBe(true);
  expect(wb.canUndo()).toBe(false);
});

it('refuses a Ctrl+Enter fill that includes only part of another array before writing any cell', () => {
  const { wb, id, grid } = setup();
  wb.setArrayFormula(id, range, '=2+3');
  wb.clearHistory();
  grid.setSelection(fromRange({ r1: 1, c1: 2, r2: 3, c2: 4 }));
  grid.beginEdit({ text: '7' });
  expect(grid.commitEdit({ fillSelection: true })).toBe(false);
  expect(grid.editing).toBe(true);
  expect(wb.getValue(id, 1, 2)).toBeNull();
  expect(wb.canUndo()).toBe(false);
});
