// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

const grids = [];
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function ({ left, top }) { this.scrollLeft = left; this.scrollTop = top; };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
});
afterEach(() => { for (const grid of grids.splice(0)) grid.destroy(); document.body.replaceChildren(); });

function mount(frozen = false) {
  const wb = new Workbook({ sheets: [{ name: 'Data', rows: 120, cols: 30, frozenRows: frozen ? 2 : 0, frozenCols: frozen ? 2 : 0 }] });
  const grid = createGrid({ wb, sheetId: wb.activeSheetId, announce() {} });
  grids.push(grid);
  document.body.append(grid.el);
  return { wb, grid, viewport: grid.viewport };
}
function key(viewport, key, init = {}) {
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true, ...init }));
}

it.each([false, true])('extends and shrinks whole columns without vertical scrolling (frozen: %s)', frozen => {
  const { grid, viewport } = mount(frozen);
  grid.selectByName('H:H');
  viewport.scrollTop = 250;
  viewport.scrollLeft = 400;
  for (let i = 0; i < 9; i++) key(viewport, 'ArrowRight');
  expect(grid.range).toMatchObject({ c1: 7, c2: 16 });
  expect(grid.selection.scope).toBe('columns');
  expect(viewport.scrollTop).toBe(250);
  expect(viewport.scrollLeft).toBeGreaterThan(400);
  const right = viewport.scrollLeft;
  for (let i = 0; i < 9; i++) key(viewport, 'ArrowLeft');
  expect(grid.range).toMatchObject({ c1: 7, c2: 7 });
  expect(viewport.scrollTop).toBe(250);
  expect(viewport.scrollLeft).toBeLessThan(right);
  // A user scroll still works while the column remains selected.
  viewport.scrollTop = 350;
  viewport.dispatchEvent(new Event('scroll'));
  expect(viewport.scrollTop).toBe(350);
});

it.each([false, true])('extends and shrinks whole rows without horizontal scrolling (frozen: %s)', frozen => {
  const { grid, viewport } = mount(frozen);
  grid.selectByName('12:12');
  viewport.scrollTop = 100;
  viewport.scrollLeft = 400;
  for (let i = 0; i < 20; i++) key(viewport, 'ArrowDown');
  expect(grid.range).toMatchObject({ r1: 11, r2: 31 });
  expect(grid.selection.scope).toBe('rows');
  expect(viewport.scrollLeft).toBe(400);
  expect(viewport.scrollTop).toBeGreaterThan(100);
  const bottom = viewport.scrollTop;
  for (let i = 0; i < 20; i++) key(viewport, 'ArrowUp');
  expect(grid.range).toMatchObject({ r1: 11, r2: 11 });
  expect(viewport.scrollLeft).toBe(400);
  expect(viewport.scrollTop).toBeLessThan(bottom);
});

it('keeps the other axis still for Ctrl/Cmd+Shift+Arrow column and row extensions', () => {
  const { grid, viewport } = mount();
  const mod = { ctrlKey: true, metaKey: true };
  grid.selectByName('H:H');
  viewport.scrollTop = 250;
  key(viewport, 'ArrowRight', mod);
  expect(grid.range.c2).toBe(16383); // XFD, past the columns reached so far
  expect(viewport.scrollTop).toBe(250);
  expect(viewport.scrollLeft).toBeGreaterThan(0);
  key(viewport, 'ArrowLeft', mod);
  expect(grid.range.c1).toBe(0);
  expect(viewport.scrollTop).toBe(250);
  expect(viewport.scrollLeft).toBe(0);
  grid.selectByName('12:12');
  viewport.scrollLeft = 400;
  key(viewport, 'ArrowDown', mod);
  expect(grid.range.r2).toBe(1048575); // row 1,048,576, past the rows reached so far
  expect(viewport.scrollLeft).toBe(400);
  expect(viewport.scrollTop).toBeGreaterThan(250);
  key(viewport, 'ArrowUp', mod);
  expect(grid.range.r1).toBe(0);
  expect(viewport.scrollLeft).toBe(400);
  expect(viewport.scrollTop).toBe(0);
});

it('still reveals the endpoint of a finite cell range reaching the last row', () => {
  const { wb, grid, viewport } = mount();
  grid.setSelection(S.fromRange({ r1: 0, c1: 1, r2: wb.activeSheet.rows - 1, c2: 1 }), { scroll: false });
  viewport.scrollTop = 250;
  key(viewport, 'ArrowRight');
  expect(grid.selection.scope).toBeUndefined();
  expect(viewport.scrollTop).toBeGreaterThan(250);
});

it('still reveals the active cell when Enter or Tab walks a whole-line selection', () => {
  const { grid, viewport } = mount();
  grid.selectByName('H:H');
  viewport.scrollTop = 250;
  key(viewport, 'Enter', { shiftKey: false });
  expect(grid.active).toEqual({ r: 1, c: 7 });
  expect(grid.selection.scope).toBe('columns');
  expect(viewport.scrollTop).toBeLessThan(250);
  grid.selectByName('12:12');
  viewport.scrollLeft = 400;
  key(viewport, 'Tab', { shiftKey: false });
  expect(grid.active).toEqual({ r: 11, c: 1 });
  expect(grid.selection.scope).toBe('rows');
  expect(viewport.scrollLeft).toBeLessThan(400);
});
