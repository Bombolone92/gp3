// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

const touch = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' }));
const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const A1B3 = { r1: 0, c1: 0, r2: 2, c2: 1 };

function setup() {
  const wb = new Workbook();
  const menus = [];
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id, announce() {}, onContextMenu: (m) => menus.push(m) });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const longPress = (x, y) => { touch(grid.viewport, 'pointerdown', x, y); vi.advanceTimersByTime(600); touch(grid.viewport, 'pointerup', x, y); };
  return { grid, menus, longPress };
}

// The long-press timer selected the pressed cell before opening the menu, so on a touch screen
// every menu action on a multi-cell selection (Copy, Clear, Delete rows, Sort) acted on one cell,
// while a right-click on the same cell kept the selection.
describe('a long press on a selected cell', () => {
  it('keeps the selection and opens the menu for the whole of it', () => {
    const { grid, menus, longPress } = setup();
    grid.setSelection(S.fromRange(A1B3, { r: 0, c: 0 }));
    longPress(150, 1.5 * ROW); // B2
    expect(grid.range).toEqual(A1B3);
    expect(grid.active).toEqual({ r: 0, c: 0 });
    expect(menus).toEqual([{ x: 150, y: 1.5 * ROW, kind: 'cell' }]);
    grid.destroy();
  });

  it('keeps a range added with Ctrl/Cmd+click too, and selects a cell outside them all', () => {
    const { grid, menus, longPress } = setup();
    grid.setRanges([A1B3, { r1: 5, c1: 3, r2: 6, c2: 3 }]);
    longPress(350, 5.5 * ROW); // D6, in the added range
    expect(grid.ranges).toEqual([A1B3, { r1: 5, c1: 3, r2: 6, c2: 3 }]);
    expect(menus).toHaveLength(1);
    longPress(550, 9.5 * ROW); // F10, outside
    expect(grid.ranges).toEqual([{ r1: 9, c1: 5, r2: 9, c2: 5 }]);
    expect(menus).toHaveLength(2);
    grid.destroy();
  });
});
