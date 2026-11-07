// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

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

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, size: () => [wb.sheet(id).rows, wb.sheet(id).cols] };
}

// Ctrl+Down in empty territory runs to the grid's last row (row 1,048,576, column XFD
// for Ctrl+Right), and stops there: pressing again neither moves nor grows anything.
describe('Ctrl+Arrow at the edge of the data', () => {
  it('stops at the grid\'s last row or column', () => {
    const { grid, size } = setup();
    expect(size()).toEqual([100, 26]);
    for (let i = 0; i < 3; i++) key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 1048575, c: 0 });
    expect(size()).toEqual([1048576, 26]);
    for (let i = 0; i < 3; i++) key(grid.viewport, 'ArrowRight', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 1048575, c: 16383 });
    expect(size()).toEqual([1048576, 16384]);
    grid.destroy();
  });

  it('extends a selection to the last row', () => {
    const { grid, size } = setup();
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1048575, c2: 0 });
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1048575, c2: 0 });
    expect(size()).toEqual([1048576, 26]);
    grid.destroy();
  });

  it('still jumps to the edge of a block of data, as before', () => {
    const { wb, id, grid, size } = setup();
    for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r));
    grid.setSelection(S.single(0, 0));
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 2, c: 0 });
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 1048575, c: 0 });
    grid.destroy();
  });

  it('leaves the plain arrow keys growing the sheet at its edge, as an endless page', () => {
    const { grid, size } = setup();
    grid.setSelection(S.single(98, 0));
    key(grid.viewport, 'ArrowDown');
    expect(grid.active).toEqual({ r: 99, c: 0 });
    expect(size()).toEqual([200, 26]);
    grid.destroy();
  });
});
