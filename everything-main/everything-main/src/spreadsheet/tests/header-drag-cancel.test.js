// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

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

function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const viewport = grid.el.querySelector('.grid-viewport');
  viewport.getBoundingClientRect = () => ({ left: 48, top: 26, right: 848, bottom: 426, width: 800, height: 400 });
  return { wb, id, grid, viewport, colClip: grid.el.querySelector('.grid-colhead-clip'), rowClip: grid.el.querySelector('.grid-rowhead-clip') };
}
const pointer = (target, type, init) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'touch', ...init }));

describe('a header drag the browser cancels', () => {
  // The header tracks captured the pointer but listened only for its move and release, so a
  // touch the browser took over for scrolling left the drag alive: hovering afterwards kept
  // extending the selection, and the edge auto-scroll kept ticking.
  it('stops selecting columns and auto-scrolling once the pointer is cancelled', () => {
    const { grid, viewport, colClip } = mount();
    const scrolls = [];
    viewport.scrollBy = (dx, dy) => scrolls.push([dx, dy]);
    pointer(colClip.querySelector('.hcell[data-c="1"]'), 'pointerdown', { clientX: 200, clientY: 13 });
    pointer(colClip, 'pointermove', { clientX: 900, clientY: 13 }); // past the right edge: auto-scroll starts
    vi.advanceTimersByTime(120);
    expect(scrolls.length).toBeGreaterThan(0);
    expect(grid.range.c2).toBeGreaterThan(1);
    pointer(colClip, 'pointercancel', { clientX: 900, clientY: 13 });
    scrolls.length = 0;
    vi.advanceTimersByTime(300);
    expect(scrolls).toEqual([]);
    const before = grid.range;
    pointer(colClip, 'pointermove', { clientX: 130, clientY: 13 });
    expect(grid.range).toEqual(before);
    grid.destroy();
  });

  it('drops a row resize and its guide when the capture is lost', () => {
    const { wb, id, grid, rowClip } = mount();
    const guide = grid.el.querySelector('.resize-guide');
    pointer(rowClip.querySelector('.row-resizer[data-r="2"]'), 'pointerdown', { clientX: 20, clientY: 104 });
    pointer(rowClip, 'pointermove', { clientX: 20, clientY: 140 });
    expect(guide.hidden).toBe(false);
    expect(grid.el.querySelector('.resize-feedback').hidden).toBe(false);
    pointer(rowClip, 'lostpointercapture', { clientX: 20, clientY: 140 });
    expect(guide.hidden).toBe(true);
    expect(grid.el.querySelector('.resize-feedback').hidden).toBe(true);
    pointer(rowClip, 'pointermove', { clientX: 20, clientY: 180 });
    pointer(rowClip, 'pointerup', { clientX: 20, clientY: 180 });
    expect(wb.rowHeight(id, 2)).toBe(DEFAULT_ROW_HEIGHT);
    grid.destroy();
  });

  it('ends a column reorder without moving anything', () => {
    const { wb, id, grid, colClip } = mount();
    wb.setInput(id, 0, 0, 'A');
    wb.setInput(id, 0, 1, 'B');
    grid.selectByName('A:A');
    vi.runOnlyPendingTimers();
    pointer(colClip.querySelector('.hcell[data-c="0"]'), 'pointerdown', { clientX: 90, clientY: 13, pointerType: 'mouse' });
    pointer(colClip, 'pointermove', { clientX: 230, clientY: 13, pointerType: 'mouse' });
    expect(grid.el.classList.contains('reordering')).toBe(true);
    pointer(colClip, 'pointercancel', { clientX: 230, clientY: 13, pointerType: 'mouse' });
    expect(grid.el.classList.contains('reordering')).toBe(false);
    expect(grid.el.querySelector('.resize-guide').hidden).toBe(true);
    pointer(colClip, 'pointerup', { clientX: 230, clientY: 13, pointerType: 'mouse' });
    expect([wb.getValue(id, 0, 0), wb.getValue(id, 0, 1)]).toEqual(['A', 'B']);
    grid.destroy();
  });
});
