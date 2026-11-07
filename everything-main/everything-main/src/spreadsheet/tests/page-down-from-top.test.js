// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

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

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const VIEWPORT_H = 400; // the clientHeight stubbed above
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

// The page size came from the rendered rows less the buffer on both sides, but at the top the
// buffer above is clamped away, so the first PageDown moved two rows short of a page.
describe('PageDown', () => {
  it('moves by the rows the viewport shows, from the top as anywhere else', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    vi.runOnlyPendingTimers();
    // The rows wholly in the 400px viewport, less one: 14 of 26px rows, 19 of 20px ones.
    const PAGE = Math.floor(VIEWPORT_H / ROW) - 1;
    key(grid.viewport, 'PageDown');
    expect(grid.active).toEqual({ r: PAGE, c: 0 });
    key(grid.viewport, 'PageDown');
    expect(grid.active).toEqual({ r: 2 * PAGE, c: 0 });
    key(grid.viewport, 'PageUp');
    expect(grid.active).toEqual({ r: PAGE, c: 0 });
    key(grid.viewport, 'PageUp', { shiftKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: PAGE, c2: 0 });
    grid.destroy();
  });
});
