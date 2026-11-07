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

describe('Ctrl+Arrow across a merged block', () => {
  it('counts a filled merge as one filled cell of the block it touches', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Title');
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 0 });
    for (const [r, v] of [[3, 'a'], [4, 'b'], [5, 'c']]) wb.setInput(id, r, 0, v);
    wb.setInput(id, 1, 2, 'Wide');
    wb.mergeCells(id, { r1: 1, c1: 2, r2: 1, c2: 4 });
    wb.setInput(id, 1, 5, 'next');
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    grid.selectByName('A1');
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 5, c: 0 });
    key(grid.viewport, 'ArrowUp', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 0, c: 0 });
    // From an empty cell below, the jump lands on the block's last cell, not inside the merge.
    grid.selectByName('A9');
    key(grid.viewport, 'ArrowUp', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 5, c: 0 });
    // Sideways too: a merge across C2:E2 next to F2 is one block from B2's point of view.
    grid.selectByName('B2');
    wb.setInput(id, 1, 1, 'from');
    key(grid.viewport, 'ArrowRight', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 1, c: 5 });
    grid.destroy();
  });

  // Started from the merge's anchor, the jump found the block's own covered cells "filled" and ran
  // to its last one, which folded back onto the anchor: a merged title above a blank spacer row was
  // a dead end for Ctrl+Down, and a merged heading for Ctrl+Right. The merge now counts as one cell.
  it('leaves a merged block from its far edge when the cell after the block is empty', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Title');
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 0 });
    wb.setInput(id, 5, 0, 'x');
    wb.setInput(id, 1, 1, 'Wide');
    wb.mergeCells(id, { r1: 1, c1: 1, r2: 1, c2: 3 });
    wb.setInput(id, 1, 5, 'next');
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    grid.selectByName('A1');
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 5, c: 0 });
    grid.selectByName('A1');
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true, shiftKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 5, c2: 0 });
    grid.selectByName('B2');
    key(grid.viewport, 'ArrowRight', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 1, c: 5 });
    key(grid.viewport, 'ArrowLeft', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 1, c: 1 });
    grid.destroy();
  });

  it('lands on a merge from an empty cell and leaves it again on the next press', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 3, 0, 'Merged');
    wb.mergeCells(id, { r1: 3, c1: 0, r2: 5, c2: 0 });
    wb.setInput(id, 8, 0, 'x');
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    grid.selectByName('A1');
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 3, c: 0 });
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 8, c: 0 });
    key(grid.viewport, 'ArrowUp', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 3, c: 0 });
    key(grid.viewport, 'ArrowUp', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 0, c: 0 });
    grid.destroy();
  });
});
