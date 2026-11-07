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
  Element.prototype.scrollBy = function scrollBy() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const rowMid = (r) => r * ROW + ROW / 2; // the middle of 0-based row r

function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Name');
  wb.setSheetProtected(id, true);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const viewport = grid.el.querySelector('.grid-viewport');
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  const pe = (type, x, y) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, button: 0, pointerType: 'mouse' }));
  return { wb, id, grid, pe };
}

// The fill handle is hidden on a protected sheet, but a press where it would be still started a
// fill drag: a preview appeared, nothing filled, and the selection jumped to the preview.
describe('a protected sheet', () => {
  it('selects instead of previewing a fill from where the handle would be', () => {
    const { wb, id, grid, pe } = mount();
    grid.setSelection(S.single(0, 0));
    vi.runOnlyPendingTimers();
    pe('pointerdown', 98, ROW - 2); // A1's bottom-right corner is at (100, ROW)
    pe('pointermove', 50, rowMid(4));
    vi.runOnlyPendingTimers();
    expect(grid.el.querySelector('.fill-preview').hidden).toBe(true);
    pe('pointerup', 50, rowMid(4));
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 4, c2: 0 });
    expect([1, 2, 3, 4].map((r) => wb.getValue(id, r, 0))).toEqual([null, null, null, null]);
  });

  it('selects instead of previewing a move from the selection border', () => {
    const { grid, pe } = mount();
    grid.setSelection(S.single(0, 0));
    vi.runOnlyPendingTimers();
    pe('pointerdown', 1, rowMid(0));
    pe('pointermove', 201, rowMid(0));
    vi.runOnlyPendingTimers();
    expect(grid.el.querySelector('.move-preview').hidden).toBe(true);
    expect(grid.el.querySelector('.grid-viewport').classList.contains('can-move')).toBe(false);
    pe('pointerup', 201, rowMid(0));
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 2 });
  });
});
