// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare?.(wb, id);
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, onCommand: (c) => commands.push(c) });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  return { wb, id, grid, commands, viewport: grid.el.querySelector('.grid-viewport') };
}
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

describe('extending a selection beside a merged block', () => {
  // The selection grew to cover the merge, but its anchor and focus were rewritten to the
  // corners of the grown box. The next Shift+Arrow then extended from the wrong cell and
  // left the active cell outside its own selection, so Delete cleared the wrong cell.
  it('keeps the anchor on the cell the extension started from', () => {
    const { grid, wb, id, viewport } = mount((wb, id) => {
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 0 });
      wb.setInput(id, 0, 1, 'B1');
      wb.setInput(id, 1, 1, 'B2');
    });
    grid.setSelection(S.single(1, 1));
    key(viewport, 'ArrowLeft', { shiftKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
    expect(grid.selection.anchor).toEqual({ r: 1, c: 1 });
    expect(grid.active).toEqual({ r: 1, c: 1 });
    key(viewport, 'ArrowRight', { shiftKey: true });
    // Back where it started: a single cell, the active cell inside it.
    expect(grid.range).toEqual({ r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(grid.active).toEqual({ r: 1, c: 1 });
    expect(S.isSingle(grid.selection)).toBe(true);
    // Extending down from the grown block keeps the merge and the anchor.
    key(viewport, 'ArrowLeft', { shiftKey: true });
    key(viewport, 'ArrowDown', { shiftKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 1 });
    expect(grid.selection.anchor).toEqual({ r: 1, c: 1 });
    // Shift+click extends from the same anchor too: away from the merge it is left behind.
    grid.setSelection(S.extendTo(grid.selection, 4, 3));
    expect(grid.range).toEqual({ r1: 1, c1: 1, r2: 4, c2: 3 });
    grid.setSelection(S.extendTo(grid.selection, 1, 2));
    expect(grid.range).toEqual({ r1: 1, c1: 1, r2: 1, c2: 2 });
    expect(wb.getValue(id, 0, 1)).toBe('B1');
    grid.destroy();
  });

  it('reports a merged cell as one cell whose active cell is its top-left', () => {
    const { grid } = mount((wb, id) => { wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 }); });
    grid.setSelection(S.single(1, 1));
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
    expect(S.isSingle(grid.selection)).toBe(true);
    // Walking with Enter still covers the grown range of a multi-cell selection: A3, B3, then the merge.
    grid.setSelection({ active: { r: 2, c: 0 }, anchor: { r: 2, c: 0 }, focus: { r: 1, c: 0 } });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
    key(grid.viewport, 'Enter');
    expect(grid.active).toEqual({ r: 2, c: 1 });
    key(grid.viewport, 'Enter');
    expect(grid.active).toEqual({ r: 0, c: 0 });
    key(grid.viewport, 'Enter');
    expect(grid.active).toEqual({ r: 2, c: 0 });
    grid.destroy();
  });
});
