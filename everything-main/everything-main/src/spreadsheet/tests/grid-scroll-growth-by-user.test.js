// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const VIEWPORT_H = 400; // the clientHeight stubbed above
/** The scrollTop that brings the last of `rows` default rows to the viewport's bottom. */
const bottom = (rows) => rows * ROW - VIEWPORT_H;
const flush = () => new Promise((r) => setTimeout(r, 5));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

/** A viewport whose scrollTo lands (jsdom has no layout), and whose scroll events are raised by hand, as a browser would after each. */
async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  const pos = { left: 0, top: 0 };
  Object.defineProperty(grid.viewport, 'scrollLeft', { configurable: true, get: () => pos.left, set: (v) => { pos.left = v; } });
  Object.defineProperty(grid.viewport, 'scrollTop', { configurable: true, get: () => pos.top, set: (v) => { pos.top = v; } });
  grid.viewport.scrollTo = ({ left, top }) => { pos.left = left; pos.top = top; };
  await flush();
  const scrolled = () => grid.viewport.dispatchEvent(new Event('scroll'));
  return { wb, id, grid, pos, scrolled, rows: () => wb.sheet(id).rows };
}

// Scrolling near the sheet's bottom grows it by a hundred rows, like an endless page. The grid's own
// scroll, bringing the active cell into view, did the same: Ctrl+Down to the last row scrolled to the
// bottom, and the scroll it caused grew the sheet on every press.
describe('growth of the sheet at its edge', () => {
  it('does not follow the scroll the grid makes to bring a cell into view', async () => {
    const { wb, id, grid, pos, scrolled, rows } = await mount();
    // Ctrl+Down on an empty column goes to the end of the grid (see grid-jump-no-growth); data in
    // the sheet's last shown row stops it there, at the edge where scrolling grows the sheet.
    wb.setInput(id, 99, 0, 'last');
    await flush();
    key(grid.viewport, 'ArrowDown', { ctrlKey: true, metaKey: true });
    expect(grid.active).toEqual({ r: 99, c: 0 });
    expect(pos.top).toBe(bottom(100)); // the last row is in view
    scrolled();
    expect(rows()).toBe(100);
    scrolled(); // the user's own scroll at the same edge still grows the sheet
    expect(rows()).toBe(200);
    grid.destroy();
  });

  it('still follows the user scrolling to the edge', async () => {
    const { grid, pos, scrolled, rows } = await mount();
    pos.top = bottom(100);
    scrolled();
    expect(rows()).toBe(200);
    // After the grid's own scroll, the user's next scroll grows the sheet again.
    grid.setSelection(S.single(0, 0));
    scrolled();
    pos.top = bottom(200);
    scrolled();
    expect(rows()).toBe(300);
    grid.destroy();
  });

  it('does not follow a sheet switch restoring its scroll position, or a zoom', async () => {
    const { wb, grid, pos, scrolled, rows } = await mount();
    const two = wb.addSheet('Two').id;
    pos.top = bottom(100);
    grid.setSheet(two);
    grid.setSheet(wb.sheets[0].id); // scrollTo(saved) lands at the bottom again
    expect(pos.top).toBe(bottom(100));
    scrolled();
    expect(rows()).toBe(100);
    // Zooming keeps the top row in place: as many rows above it as before, each now half as tall
    // (rounded to whole pixels), which is near the bottom of the half-height sheet.
    const topRow = Math.floor(bottom(100) / ROW);
    grid.setZoom(0.5);
    expect(pos.top).toBe(topRow * Math.round(DEFAULT_ROW_HEIGHT * 0.5));
    scrolled();
    expect(rows()).toBe(100);
    grid.destroy();
  });
});
