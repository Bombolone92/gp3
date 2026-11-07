// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

let grid;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
});
afterEach(() => { grid?.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function mount({ width = 800, height = 400, frozenRows = 0, frozenCols = 0 } = {}) {
  const wb = new Workbook({ sheets: [{ frozenRows, frozenCols }] });
  grid = createGrid({ wb, sheetId: wb.activeSheetId, announce() {} });
  document.body.append(grid.el);
  const vp = grid.viewport;
  Object.defineProperties(vp, {
    clientWidth: { value: width, configurable: true }, clientHeight: { value: height, configurable: true },
    scrollWidth: { value: 2600, configurable: true }, scrollHeight: { value: 2600, configurable: true },
  });
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: height, width, height });
  vp.scrollTo = ({ left, top }) => { vp.scrollLeft = left; vp.scrollTop = top; };
  grid.refresh();
  vi.advanceTimersByTime(1);
  return wb;
}

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const GAP = 6; // the margin the grid keeps between a revealed cell and the panel
const panel = { left: 440, right: 790, top: 0, bottom: 140 };
const clearOf = (cell, obstacle) => cell.right <= obstacle.left || cell.left >= obstacle.right || cell.bottom <= obstacle.top || cell.top >= obstacle.bottom;

it('uncovers a first-row result with the smallest horizontal scroll without changing selection', () => {
  mount();
  grid.setSelection(S.single(0, 6));
  expect(grid.scrollToActive({ avoid: panel })).toBe(true);
  expect(grid.viewport.scrollLeft).toBe(266);
  expect(grid.viewport.scrollTop).toBe(0);
  expect(clearOf(grid.cellRect(0, 6), panel)).toBe(true);
  expect(grid.active).toEqual({ r: 0, c: 6 });
});

it('keeps the viewport still when the result is already clear', () => {
  mount(); grid.setSelection(S.single(0, 0));
  expect(grid.scrollToActive({ avoid: panel })).toBe(true);
  expect(grid.viewport.scrollLeft).toBe(0); expect(grid.viewport.scrollTop).toBe(0);
});

it('reports when a narrow first-row result needs the panel to move', () => {
  mount({ width: 300 }); grid.setSelection(S.single(0, 0));
  expect(grid.scrollToActive({ avoid: { left: 0, right: 300, top: 0, bottom: 140 } })).toBe(false);
  expect(grid.viewport.scrollLeft).toBe(0); expect(grid.viewport.scrollTop).toBe(0);
});

it('scrolls a later result above a bottom-docked panel', () => {
  mount({ width: 300 }); grid.setSelection(S.single(20, 0));
  const bottom = { left: 0, right: 300, top: 260, bottom: 400 };
  expect(grid.scrollToActive({ avoid: bottom })).toBe(true);
  expect(clearOf(grid.cellRect(20, 0), bottom)).toBe(true);
  expect(grid.viewport.scrollTop).toBe(21 * ROW - (bottom.top - GAP)); // A21's bottom edge lands GAP above the panel
});

it('does not scroll frozen cells out of their panes', () => {
  mount({ frozenRows: 1, frozenCols: 1 }); grid.setSelection(S.single(0, 0));
  expect(grid.frozen).toEqual({ rows: 1, cols: 1 });
  expect(grid.scrollToActive({ avoid: { left: 0, right: 200, top: 0, bottom: 140 } })).toBe(false);
  expect(grid.viewport.scrollLeft).toBe(0); expect(grid.viewport.scrollTop).toBe(0);
});

it('uses screen-space dimensions at custom zoom levels', () => {
  mount(); grid.setZoom(1.33); grid.setSelection(S.single(0, 5));
  expect(grid.scrollToActive({ avoid: panel })).toBe(true);
  expect(clearOf(grid.cellRect(0, 5), panel)).toBe(true);
  expect(grid.viewport.scrollTop).toBe(0);
});

it('uncovers the entire merged result, including its far edge', () => {
  const wb = mount();
  wb.mergeCells(wb.activeSheetId, { r1: 0, c1: 4, r2: 0, c2: 6 });
  grid.setSelection(S.single(0, 4));
  expect(grid.scrollToActive({ avoid: panel })).toBe(true);
  expect(grid.cellRect(0, 6).right).toBeLessThanOrEqual(panel.left - 6);
});
