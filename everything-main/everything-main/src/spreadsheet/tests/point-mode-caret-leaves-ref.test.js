// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { createFormulaBar } from '../src/ui/formulabar.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const keyup = (target, k) => target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
const cell = (r, c) => ({ r1: r, c1: c, r2: r, c2: c });

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const listeners = new Set();
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {}, onSelection: () => { for (const fn of listeners) fn(); }, onEdit: () => { for (const fn of listeners) fn(); } });
  const bar = createFormulaBar({
    wb, grid, run() {}, announce() {}, goToName: () => false,
    sheetId: () => grid.sheetId, activeCell: () => wb.getCell(grid.sheetId, grid.active.r, grid.active.c),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  });
  document.body.replaceChildren(grid.el, bar.el);
  grid.setSelection({ active: { r: 2, c: 2 }, anchor: { r: 2, c: 2 }, focus: { r: 2, c: 2 } });
  return { grid, bar, editor: grid.el.querySelector('.grid-editor'), input: bar.el.querySelector('.formula-input') };
}

// A picked reference stayed the one the next pick replaced even after the caret had been moved
// somewhere else in the formula, so a pick meant for that spot overwrote the earlier reference.
it('inserts the next pick at the caret once a click or Home has moved it off the picked reference', () => {
  const { grid, editor } = setup();
  grid.beginEdit({ text: '=', mode: 'type' });
  grid.insertRef(cell(0, 0));
  expect(editor.value).toBe('=A1');
  editor.setSelectionRange(1, 1);
  editor.click();
  grid.insertRef(cell(1, 1));
  expect(editor.value).toBe('=B2A1');
  grid.cancelEdit();
  grid.beginEdit({ text: '=SUM(', mode: 'type' });
  grid.insertRef(cell(0, 0));
  editor.setSelectionRange(1, 1);
  keyup(editor, 'Home');
  grid.insertRef(cell(1, 1));
  expect(editor.value).toBe('=B2SUM(A1');
  grid.destroy();
});

it('still replaces the picked reference while the caret sits at its end, as after an arrow moves it', () => {
  const { grid, editor } = setup();
  grid.beginEdit({ text: '=SUM(', mode: 'type' });
  key(editor, 'ArrowLeft');
  expect(editor.value).toBe('=SUM(B3');
  keyup(editor, 'ArrowLeft');
  key(editor, 'ArrowLeft');
  expect(editor.value).toBe('=SUM(A3');
  keyup(editor, 'ArrowLeft');
  grid.insertRef(cell(0, 0));
  expect(editor.value).toBe('=SUM(A1');
  grid.destroy();
});

it('does the same for a pick made from the formula bar', async () => {
  const { grid, editor, input } = setup();
  await new Promise((r) => setTimeout(r, 5));
  input.focus();
  input.value = '=';
  input.dispatchEvent(new Event('input'));
  expect(grid.editing).toBe(true);
  grid.insertRef(cell(0, 0));
  expect(input.value).toBe('=A1');
  input.setSelectionRange(1, 1);
  keyup(input, 'Home');
  grid.insertRef(cell(1, 1));
  expect(input.value).toBe('=B2A1');
  expect(editor.value).toBe('=B2A1');
  grid.destroy();
});
