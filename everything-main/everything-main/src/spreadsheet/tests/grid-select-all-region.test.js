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
const BLOCK = { r1: 0, c1: 0, r2: 3, c2: 2 };
const SHEET = { r1: 0, c1: 0, r2: 1048575, c2: 16383 }; // the whole grid

/** A 4-row, 3-column block of data at A1:C4, with a lone value far away at H10. */
function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, `${r},${c}`);
  wb.setInput(id, 9, 7, 'alone');
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, viewport: grid.viewport };
}

// Ctrl+A selected the whole sheet at once, so selecting "my table" took a drag or Ctrl+Shift+End.
// Now the first press inside a block of data selects the block, and the second the sheet.
describe('Ctrl/Cmd+A', () => {
  it('selects the block of data around the active cell first, keeping the active cell, and the whole sheet on the second press', () => {
    const { grid, viewport } = setup();
    grid.setSelection(S.single(1, 1));
    key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.range).toEqual(BLOCK);
    expect(grid.active).toEqual({ r: 1, c: 1 });
    key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.range).toEqual(SHEET);
    grid.destroy();
  });

  it('selects the whole sheet at once from a cell with no block around it, or one alone', () => {
    const { grid, viewport } = setup();
    grid.setSelection(S.single(6, 5));
    key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.range).toEqual(SHEET);
    grid.setSelection(S.single(9, 7));
    key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.range).toEqual(SHEET);
    grid.destroy();
  });

  it('selects the whole sheet when the block is already selected, and clears any added ranges', () => {
    const { grid, viewport } = setup();
    grid.setSelection(S.fromRange(BLOCK, { r: 2, c: 0 }));
    key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.range).toEqual(SHEET);
    grid.setRanges([{ r1: 9, c1: 7, r2: 9, c2: 7 }, { r1: 1, c1: 1, r2: 1, c2: 1 }]);
    key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.ranges).toEqual([BLOCK]);
    grid.destroy();
  });

  it('is what Ctrl+Shift+Space and the grid\'s selectAll() do too', () => {
    const { grid, viewport } = setup();
    grid.setSelection(S.single(3, 2));
    key(viewport, ' ', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(grid.range).toEqual(BLOCK);
    key(viewport, ' ', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(grid.range).toEqual(SHEET);
    grid.setSelection(S.single(0, 0));
    grid.selectAll();
    expect(grid.range).toEqual(BLOCK);
    grid.selectAll();
    expect(grid.range).toEqual(SHEET);
    grid.destroy();
  });

  // A third press went back to the block: once the range was the whole sheet it no longer equalled
  // the region, so the region was selected again. It now settles on the whole sheet.
  it('keeps the whole sheet on a third press, and after the select-all corner', () => {
    const { grid, viewport } = setup();
    grid.setSelection(S.single(1, 1));
    for (let i = 0; i < 4; i++) key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.range).toEqual(SHEET);
    grid.el.querySelector('.grid-corner').click();
    key(viewport, 'a', { ctrlKey: true, metaKey: true });
    expect(grid.range).toEqual(SHEET);
    grid.destroy();
  });

  it('leaves the select-all corner selecting the whole sheet at once', () => {
    const { grid } = setup();
    grid.setSelection(S.single(1, 1));
    grid.el.querySelector('.grid-corner').click();
    expect(grid.range).toEqual(SHEET);
    grid.destroy();
  });
});
