// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollBy = function scrollBy() {};
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

/** A grid whose viewport is 800×400 at (0, 0) on the screen, with a scroll that the grid's own scrollTo moves. */
function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare?.(wb, id);
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (c, arg) => commands.push([c, arg]) });
  document.body.replaceChildren(grid.el);
  const viewport = grid.el.querySelector('.grid-viewport');
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  const scroll = { left: 0, top: 0 };
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => scroll.left, set: (v) => { scroll.left = v; } });
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, get: () => scroll.top, set: (v) => { scroll.top = v; } });
  viewport.scrollTo = ({ left, top }) => { scroll.left = Math.max(0, left); scroll.top = Math.max(0, top); viewport.dispatchEvent(new Event('scroll')); };
  const flush = () => vi.runOnlyPendingTimers();
  flush();
  // The grid lays each line out in whole pixels.
  const col = (c) => Math.round(wb.colWidth(id, c)), row = (r) => Math.round(wb.rowHeight(id, r));
  const x = (c) => Array.from({ length: c }, (_, i) => col(i)).reduce((a, b) => a + b, 0);
  const y = (r) => Array.from({ length: r }, (_, i) => row(i)).reduce((a, b) => a + b, 0);
  return { wb, id, grid, viewport, scroll, flush, commands, x, y };
}
const pointer = (target, type, init) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));
const click = (target, clientX, clientY) => { pointer(target, 'pointerdown', { clientX, clientY }); pointer(target, 'pointerup', { clientX, clientY }); };

describe('View ▸ Split', () => {
  it('splits the window above and left of the active cell, keeping what it shows, and toggles off', () => {
    const { wb, id, grid, viewport, scroll, flush, x, y } = mount();
    grid.setSelection(S.single(9, 4)); // E10
    flush();
    grid.toggleSplit();
    flush();
    expect(wb.sheet(id).split).toEqual({ x: x(4), y: y(9), r: 0, c: 0 });
    expect(grid.split).toMatchObject({ x: x(4), y: y(9), sl: 0, st: 0 });
    // The scrolling pane's canvas sits in by the split, and is scrolled so it shows what it did.
    const canvas = grid.el.querySelector('.grid-canvas');
    expect(canvas.style.marginLeft).toBe(`${x(4)}px`);
    expect(canvas.style.marginTop).toBe(`${y(9)}px`);
    expect([scroll.left, scroll.top]).toEqual([x(4), y(9)]);
    expect(grid.el.classList.contains('split-panes')).toBe(true);
    for (const bar of grid.el.querySelectorAll('.split-bar')) expect(bar.hidden).toBe(false);
    for (const layer of grid.el.querySelectorAll('.frz-layer')) expect(layer.hidden).toBe(false);
    // The top-left pane draws the cells above and left of E10.
    expect(grid.el.querySelector('.frz-corner .frz-cells').textContent).toBe('');
    grid.toggleSplit();
    flush();
    expect(wb.sheet(id).split).toBeUndefined();
    expect(canvas.style.marginLeft).toBe('');
    expect([scroll.left, scroll.top]).toEqual([0, 0]);
    for (const layer of grid.el.querySelectorAll('.frz-layer')) expect(layer.hidden).toBe(true);
    for (const bar of grid.el.querySelectorAll('.split-bar')) expect(bar.hidden).toBe(true);
    void viewport;
    grid.destroy();
  });

  it('splits one way on the first row or column shown, and in the middle at the top-left cell', () => {
    const { wb, id, grid, flush, x, y } = mount();
    grid.setSelection(S.single(0, 3)); // D1
    grid.toggleSplit();
    expect(wb.sheet(id).split).toMatchObject({ x: x(3), y: 0 });
    grid.toggleSplit();
    grid.setSelection(S.single(5, 0)); // A6
    grid.toggleSplit();
    expect(wb.sheet(id).split).toMatchObject({ x: 0, y: y(5) });
    grid.toggleSplit();
    grid.setSelection(S.single(0, 0));
    grid.toggleSplit();
    flush();
    const split = wb.sheet(id).split;
    // Near the middle, on a line between cells.
    expect(Math.abs(split.x - 400)).toBeLessThanOrEqual(col0(wb, id));
    expect(Math.abs(split.y - 200)).toBeLessThanOrEqual(wb.rowHeight(id, 0));
    expect(Array.from({ length: 30 }, (_, c) => x(c))).toContain(split.x);
    expect(Array.from({ length: 30 }, (_, r) => y(r))).toContain(split.y);
    grid.destroy();
  });

  it('unfreezes, and freezing removes the split', () => {
    const { wb, id, grid, flush } = mount((wb, id) => wb.setFrozen(id, 2, 1));
    grid.setSelection(S.single(5, 3));
    grid.toggleSplit();
    flush();
    expect([wb.sheet(id).frozenRows, wb.sheet(id).frozenCols]).toEqual([0, 0]);
    expect(wb.sheet(id).split).toBeTruthy();
    expect(grid.el.querySelector('.freeze-bar.v').closest('.split-panes')).toBeTruthy();
    wb.setFrozen(id, 1, 0);
    flush();
    expect(wb.sheet(id).split).toBeUndefined();
    expect(grid.split).toBeNull();
    expect(grid.frozen).toEqual({ rows: 1, cols: 0 });
    expect(grid.el.querySelector('.grid-canvas').style.marginTop).toBe('');
    grid.destroy();
  });

  it('scrolls each pane on its own and selects the cell under the pointer in any pane', () => {
    const { wb, id, grid, viewport, scroll, flush, x, y } = mount((wb, id) => wb.setSplit(id, { x: 200, y: 100, r: 0, c: 0 }));
    flush();
    expect(grid.split).toMatchObject({ x: 200, y: 100 });
    // The bottom-right pane starts at A1 below and right of the bars.
    expect([scroll.left, scroll.top]).toEqual([0, 0]);
    // Scroll the top panes down 5 rows with the wheel: the viewport (the bottom pane) stays.
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: y(5), clientX: 300, clientY: 20, bubbles: true, cancelable: true }));
    flush();
    expect(grid.split.st).toBe(y(5));
    expect(scroll.top).toBe(0);
    expect(wb.sheet(id).split).toMatchObject({ r: 5, c: 0 });
    // Scroll the bottom pane down 20 rows natively.
    scroll.top = y(20);
    viewport.dispatchEvent(new Event('scroll'));
    flush();
    // A press in the top-left pane, on its first row: row 6 (index 5), column A.
    click(viewport, 5, 3);
    expect(grid.active).toEqual({ r: 5, c: 0 });
    expect(grid.split.pane).toEqual({ left: true, top: true });
    // A press in the bottom-right pane just under the bar: the row 20 rows down from the top (scroll is from row 1).
    click(viewport, 205, 103);
    expect(grid.active.r).toBe(rowAt(wb, id, y(20) + 3));
    expect(grid.active.c).toBe(colAt(wb, id, 5));
    expect(grid.split.pane).toEqual({ left: false, top: false });
    // The top pane's track follows its own scroll down and the bottom pane's across (which shows column A
    // at the bar); the left pane's follows the bottom pane's scroll down (row 1 is at the bar, 20 rows up).
    const rowsTrack = grid.el.querySelector('.frz-rows .frz-track');
    const colsTrack = grid.el.querySelector('.frz-cols .frz-track');
    expect(rowsTrack.style.transform).toBe(`translate(200px, ${-y(5)}px)`);
    expect(colsTrack.style.transform).toBe(`translate(0px, ${-(y(20) - 100)}px)`);
    void x;
    grid.destroy();
  });

  it('keeps keyboard navigation in the active pane, scrolling that pane', () => {
    const { wb, id, grid, viewport, scroll, flush, y } = mount((wb, id) => wb.setSplit(id, { x: 0, y: 100, r: 0, c: 0 }));
    flush();
    click(viewport, 5, 3); // A1 in the top pane
    expect(grid.active).toEqual({ r: 0, c: 0 });
    const rowsShown = Math.floor(100 / Math.round(wb.rowHeight(id, 0)));
    for (let i = 0; i < rowsShown + 3; i++) viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    flush();
    expect(grid.active.r).toBe(rowsShown + 3);
    // The top pane scrolled to keep the active cell in it; the bottom pane did not move.
    expect(grid.split.st).toBeGreaterThan(0);
    expect(y(grid.active.r + 1) - grid.split.st).toBeLessThanOrEqual(100);
    expect(scroll.top).toBe(0);
    grid.destroy();
  });

  it('moves a bar by dragging, removes it dragged to the edge or double-clicked', () => {
    const { wb, id, grid, flush, x } = mount((wb, id) => wb.setSplit(id, { x: 200, y: 100, r: 0, c: 0 }));
    grid.el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 848, bottom: 426, width: 848, height: 426 });
    flush();
    const v = grid.el.querySelector('.split-bar.v');
    const h = grid.el.querySelector('.split-bar.h');
    const headerW = parseFloat(v.style.transform.match(/translateX\(([-\d.]+)px\)/)[1]) - 200;
    pointer(v, 'pointerdown', { clientX: headerW + 200, clientY: 50 });
    pointer(v, 'pointermove', { clientX: headerW + x(3) + 10, clientY: 50 });
    pointer(v, 'pointerup', { clientX: headerW + x(3) + 10, clientY: 50 });
    flush();
    expect(wb.sheet(id).split.x).toBe(x(3)); // came to rest on the line between C and D
    pointer(v, 'pointerdown', { clientX: headerW + x(3), clientY: 50 });
    pointer(v, 'pointermove', { clientX: headerW + 2, clientY: 50 });
    pointer(v, 'pointerup', { clientX: headerW + 2, clientY: 50 });
    flush();
    expect(wb.sheet(id).split).toMatchObject({ x: 0, y: 100 });
    expect(v.hidden).toBe(true);
    h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    flush();
    expect(wb.sheet(id).split).toBeUndefined();
    expect(h.hidden).toBe(true);
    grid.destroy();
  });

  it('draws the sheet\'s charts in every pane, the copies taking no presses', () => {
    const { grid, flush } = mount((wb, id) => {
      wb.setInput(id, 0, 0, '1'); wb.setInput(id, 1, 0, '2');
      wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor: { r: 1, c: 1 }, w: 300, h: 200 });
      wb.setSplit(id, { x: 200, y: 100, r: 0, c: 0 });
    });
    flush();
    const copies = grid.el.querySelectorAll('.frz-layer .split-objects');
    expect(copies.length).toBe(3);
    for (const copy of copies) {
      expect(copy.querySelectorAll('.chart-box').length).toBe(1);
      expect(copy.inert).toBe(true);
      expect(copy.querySelector('[id]')).toBeNull();
    }
    expect(grid.el.querySelectorAll('.grid-canvas .chart-box').length).toBe(1);
    grid.destroy();
  });

  it('edits a cell of the top-left pane where that pane shows it', () => {
    const { grid, viewport, scroll, flush, y } = mount((wb, id) => wb.setSplit(id, { x: 200, y: 100, r: 0, c: 0 }));
    flush();
    scroll.top = y(30);
    viewport.dispatchEvent(new Event('scroll'));
    flush();
    click(viewport, 5, 3); // A1 in the top-left pane
    grid.beginEdit({ text: 'x' });
    flush();
    const editor = grid.el.querySelector('.grid-editor');
    expect(editor.parentNode).toBe(grid.el); // over the panes, not in the scrolled canvas
    const top = parseFloat(editor.style.top), left = parseFloat(editor.style.left);
    const v = grid.el.querySelector('.split-bar.v');
    const headerW = parseFloat(v.style.transform.match(/translateX\(([-\d.]+)px\)/)[1]) - 200;
    expect(left).toBe(headerW);
    expect(top).toBeLessThan(100); // in the top pane, not 30 rows down
    grid.destroy();
  });
});

function col0(wb, id) { return wb.colWidth(id, 0); }
function rowAt(wb, id, py) { let r = 0, acc = 0; while (acc + Math.round(wb.rowHeight(id, r)) <= py) acc += Math.round(wb.rowHeight(id, r++)); return r; }
function colAt(wb, id, px) { let c = 0, acc = 0; while (acc + Math.round(wb.colWidth(id, c)) <= px) acc += Math.round(wb.colWidth(id, c++)); return c; }
