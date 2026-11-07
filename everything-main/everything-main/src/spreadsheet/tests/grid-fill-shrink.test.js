// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const mid = (r) => r * ROW + ROW / 2; // the middle of row r on screen
const flush = () => new Promise((r) => setTimeout(r, 5));
const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, String(r * 3 + c + 1));
  wb.clearHistory();
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid };
}

// Dragging the fill handle back into the selection pulls its far edge in and clears the cells
// left outside; the selection follows.
describe('dragging the fill handle into the selection', () => {
  it('clears the rows dragged over and shrinks the selection', async () => {
    const { wb, id, grid } = setup();
    await flush();
    grid.selectByName('A1:A3');
    pointer(grid.viewport, 'pointerdown', 99, 3 * ROW - 1); // the handle at A3's corner
    pointer(grid.viewport, 'pointermove', 50, mid(1)); // up into A2
    pointer(grid.viewport, 'pointerup', 50, mid(1));
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([1, 4, null]);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 });
    expect(wb.getValue(id, 2, 1)).toBe(8); // other columns untouched
    wb.undo();
    expect(wb.getValue(id, 2, 0)).toBe(7);
    expect(wb.canUndo()).toBe(false);
    grid.destroy();
  });

  it('clears the columns dragged over when pulled left', async () => {
    const { wb, id, grid } = setup();
    await flush();
    grid.selectByName('A1:C1');
    pointer(grid.viewport, 'pointerdown', 299, ROW - 1); // the handle at C1's corner
    pointer(grid.viewport, 'pointermove', 150, mid(0)); // into B1
    pointer(grid.viewport, 'pointerup', 150, mid(0));
    expect([0, 1, 2].map((c) => wb.getValue(id, 0, c))).toEqual([1, 2, null]);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 1 });
    grid.destroy();
  });

  it('does nothing when the handle is released in its own cell', async () => {
    const { wb, id, grid } = setup();
    await flush();
    grid.selectByName('A1:A3');
    pointer(grid.viewport, 'pointerdown', 99, 3 * ROW - 1); // the handle at A3's corner
    pointer(grid.viewport, 'pointermove', 60, mid(2)); // still inside A3
    pointer(grid.viewport, 'pointerup', 60, mid(2));
    expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([1, 4, 7]);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
    expect(wb.canUndo()).toBe(false);
    grid.destroy();
  });
});
