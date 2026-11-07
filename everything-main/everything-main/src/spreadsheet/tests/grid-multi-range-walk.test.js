// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
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
const A1B1 = { r1: 0, c1: 0, r2: 0, c2: 1 };
const A3B3 = { r1: 2, c1: 0, r2: 2, c2: 1 };

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, viewport: grid.viewport };
}

// Tab and Enter set the selection afresh, dropping every range added with Ctrl/Cmd+click, so an
// entry into the second of two picked ranges lost the first. Every area is now kept, and
// the active cell walks through all of them in turn.
describe('Tab and Enter over ranges added with Ctrl/Cmd+click', () => {
  it('walk the active cell through the current range, then on into the next, keeping every range', () => {
    const { grid, viewport } = setup();
    grid.setRanges([A1B1, A3B3], { r: 2, c: 0 });
    key(viewport, 'Tab');
    expect(grid.active).toEqual({ r: 2, c: 1 });
    expect(grid.ranges).toEqual([A1B1, A3B3]);
    key(viewport, 'Tab'); // off the end of A3:B3, into the first range
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(grid.ranges).toEqual([A3B3, A1B1]);
    key(viewport, 'Tab');
    expect(grid.active).toEqual({ r: 0, c: 1 });
    key(viewport, 'Tab'); // and round again
    expect(grid.active).toEqual({ r: 2, c: 0 });
    expect(grid.ranges).toEqual([A1B1, A3B3]);
    key(viewport, 'Tab', { shiftKey: true }); // back into the range before, at its last cell
    expect(grid.active).toEqual({ r: 0, c: 1 });
    expect(grid.ranges).toEqual([A3B3, A1B1]);
    key(viewport, 'Enter');
    expect(grid.active).toEqual({ r: 2, c: 0 }); // Enter walks the columns of a one-row range, then moves on
    key(viewport, 'Enter', { shiftKey: true });
    expect(grid.active).toEqual({ r: 0, c: 1 });
    grid.destroy();
  });

  it('keep the ranges when an entry is committed with Enter or Tab', () => {
    const { wb, id, grid, viewport } = setup();
    grid.setRanges([A1B1, A3B3], { r: 2, c: 0 });
    key(viewport, 'v');
    expect(grid.editing).toBe(true);
    grid.commitEdit({ move: 'down' });
    expect(wb.getValue(id, 2, 0)).toBe('v');
    expect(grid.active).toEqual({ r: 2, c: 1 });
    expect(grid.ranges).toEqual([A1B1, A3B3]);
    key(viewport, 'w');
    grid.commitEdit({ move: 'right' });
    expect(wb.getValue(id, 2, 1)).toBe('w');
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(grid.ranges).toEqual([A3B3, A1B1]);
    grid.destroy();
  });

  it('step from one picked cell to the next when the ranges are single cells', () => {
    const { grid, viewport } = setup();
    const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const C3 = { r1: 2, c1: 2, r2: 2, c2: 2 };
    const E5 = { r1: 4, c1: 4, r2: 4, c2: 4 };
    grid.setRanges([A1, C3, E5]);
    expect(grid.active).toEqual({ r: 4, c: 4 });
    key(viewport, 'Tab');
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(grid.ranges).toEqual([C3, E5, A1]);
    key(viewport, 'Enter');
    expect(grid.active).toEqual({ r: 2, c: 2 });
    key(viewport, 'Enter', { shiftKey: true });
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(grid.ranges).toEqual([C3, E5, A1]);
    grid.destroy();
  });

  it('pass over hidden lines and covered cells of the next range', () => {
    const { wb, id, grid, viewport } = setup();
    wb.setHidden(id, 'row', [0], true);
    wb.mergeCells(id, { r1: 2, c1: 0, r2: 2, c2: 1 });
    grid.setRanges([{ r1: 0, c1: 0, r2: 1, c2: 0 }, A3B3], { r: 2, c: 0 });
    key(viewport, 'Tab'); // A3:B3 is one merged cell: straight on into A1:A2, whose first row is hidden
    expect(grid.active).toEqual({ r: 1, c: 0 });
    expect(grid.ranges).toHaveLength(2);
    grid.destroy();
  });

  it('leave a lone range walking as before', () => {
    const { grid, viewport } = setup();
    grid.setRanges([A3B3], { r: 2, c: 1 });
    key(viewport, 'Tab');
    expect(grid.active).toEqual({ r: 2, c: 0 });
    expect(grid.ranges).toEqual([A3B3]);
    grid.destroy();
  });
});
