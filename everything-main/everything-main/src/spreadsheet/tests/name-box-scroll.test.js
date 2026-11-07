// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const ROW2_TOP = 1 * ROW; // row 2 starts one row down

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

/** A grid whose viewport remembers where it was scrolled to, starting 550px right and 600px down. */
function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  const viewport = grid.el.querySelector('.grid-viewport');
  const pos = { left: 550, top: 600 };
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => pos.left, set: (v) => { pos.left = v; } });
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, get: () => pos.top, set: (v) => { pos.top = v; } });
  viewport.scrollTo = ({ left, top }) => { pos.left = left; pos.top = top; };
  viewport.dispatchEvent(new Event('scroll'));
  vi.runOnlyPendingTimers();
  return { grid, pos, reset() { pos.left = 550; pos.top = 600; } };
}

// Selecting by name scrolled to the selection's far corner, so A:C jumped to the last row, 2:3
// to the last column, and B2:C40 to row 40. The top-left now comes into view.
describe('the name box', () => {
  it('scrolls whole columns into view sideways only, and whole rows up or down only', () => {
    const { grid, pos, reset } = mount();
    expect(grid.selectByName('A:C')).toBe(true);
    expect(pos).toEqual({ left: 0, top: 600 });
    reset();
    expect(grid.selectByName('2:3')).toBe(true);
    expect(pos).toEqual({ left: 550, top: ROW2_TOP });
    // Lines already in view leave the scroll position alone.
    reset();
    expect(grid.selectByName('G:H')).toBe(true); // G starts at 600px: on screen at 50px
    expect(pos).toEqual({ left: 550, top: 600 });
    grid.destroy();
  });

  it('brings the top-left of a range into view, not its bottom-right', () => {
    const { grid, pos } = mount();
    expect(grid.selectByName('B2:C40')).toBe(true);
    expect(pos).toEqual({ left: 100, top: ROW2_TOP });
    expect(grid.active).toEqual({ r: 1, c: 1 });
    grid.destroy();
  });
});
