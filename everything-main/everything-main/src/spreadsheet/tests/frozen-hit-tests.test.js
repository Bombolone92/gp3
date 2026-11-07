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
  Element.prototype.scrollBy = function scrollBy() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

/** A grid with `cols` frozen columns, scrolled 550px to the right; the viewport's top-left is at (48, 26). */
function mount(cols, prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setFrozen(id, 0, cols);
  prepare?.(wb, id);
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, onCommand: (c, arg) => commands.push([c, arg]) });
  document.body.replaceChildren(grid.el);
  const viewport = grid.el.querySelector('.grid-viewport');
  viewport.getBoundingClientRect = () => ({ left: 48, top: 26, right: 848, bottom: 426, width: 800, height: 400 });
  grid.el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 848, bottom: 426, width: 848, height: 426 });
  let scrollLeft = 550;
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (v) => { scrollLeft = v; } });
  viewport.dispatchEvent(new Event('scroll'));
  vi.runOnlyPendingTimers();
  return { wb, id, grid, commands, viewport, colClip: grid.el.querySelector('.grid-colhead-clip') };
}
const pointer = (target, type, init) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));

// Four hit-tests added the scroll offset to every pointer position, though inside a frozen pane
// the content has not scrolled. Each one now uses the same rule as cellAtPoint.
describe('pointer hit-tests inside frozen columns while scrolled', () => {
  it('does not start moving a scrolled-away selection from a press on a frozen cell', () => {
    const { wb, id, grid, viewport } = mount(1, (wb, id) => { wb.setInput(id, 0, 6, 'g'); });
    grid.setSelection(S.single(0, 6)); // G1: its left border, 600px into the sheet, is 50px on screen and under frozen A
    vi.runOnlyPendingTimers();
    pointer(viewport, 'pointerdown', { clientX: 98, clientY: 39 }); // on A1
    pointer(viewport, 'pointermove', { clientX: 98, clientY: 65 }); // down to A2
    pointer(viewport, 'pointerup', { clientX: 98, clientY: 65 });
    expect(wb.getValue(id, 0, 6)).toBe('g');
    expect(wb.getValue(id, 1, 6)).toBeNull();
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 });
    grid.destroy();
  });

  it('freezes at the frozen column the freeze bar is dropped on, not the scrolled one beneath', () => {
    const { grid, commands } = mount(2);
    const bar = grid.el.querySelector('.freeze-bar.v');
    pointer(bar, 'pointerdown', { clientX: 245, clientY: 10 });
    pointer(bar, 'pointermove', { clientX: 198, clientY: 10 }); // over frozen B
    pointer(bar, 'pointerup', { clientX: 198, clientY: 10 });
    expect(commands).toEqual([['freeze', { cols: 2 }]]);
    grid.destroy();
  });

  it('draws the resize guide at a frozen column edge where it is on screen', () => {
    const { grid, colClip } = mount(1);
    const guide = grid.el.querySelector('.resize-guide');
    pointer(colClip.querySelector('.col-resizer[data-c="0"]'), 'pointerdown', { clientX: 148, clientY: 13 });
    expect(guide.style.transform).toBe('translateX(148px)');
    pointer(colClip, 'pointermove', { clientX: 168, clientY: 13 });
    expect(guide.style.transform).toBe('translateX(168px)');
    pointer(colClip, 'pointerup', { clientX: 168, clientY: 13 });
    grid.destroy();
  });

  it('drops a frozen column where the pointer is, not where the scrolled sheet would put it', () => {
    const { wb, id, grid, colClip } = mount(2, (wb, id) => { wb.setInput(id, 0, 0, 'a'); wb.setInput(id, 0, 1, 'b'); wb.setInput(id, 0, 2, 'c'); });
    grid.selectByName('A:A');
    vi.runOnlyPendingTimers();
    const guide = grid.el.querySelector('.resize-guide');
    pointer(colClip.querySelector('.hcell[data-c="0"]'), 'pointerdown', { clientX: 98, clientY: 13 });
    pointer(colClip, 'pointermove', { clientX: 198, clientY: 13 }); // the left half of frozen B: before B, where A already is
    expect(guide.style.transform).toBe('translateX(148px)');
    pointer(colClip, 'pointerup', { clientX: 198, clientY: 13 });
    expect([0, 1, 2].map((c) => wb.getValue(id, 0, c))).toEqual(['a', 'b', 'c']);
    grid.destroy();
  });
});
