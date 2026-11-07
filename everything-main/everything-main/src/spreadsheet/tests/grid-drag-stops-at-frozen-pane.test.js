// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.scrollBy = function scrollBy(x, y) {
    this.scrollLeft = Math.max(0, this.scrollLeft + (x || 0));
    this.scrollTop = Math.max(0, this.scrollTop + (y || 0));
    this.dispatchEvent(new Event('scroll'));
  };
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false; };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const ROW3_Y = 2.5 * ROW; // the middle of row 3
const ROW3_BOTTOM = 3 * ROW; // the bottom edge of row 3, where its fill handle sits

const flush = () => new Promise((r) => setTimeout(r, 5));

/** A grid on an 800×400 viewport whose top-left corner is the screen's: columns are 100px, rows ROW px. */
async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare?.(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  const vp = grid.viewport;
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  await flush();
  const pe = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));
  const scrollTo = async (left = 0, top = 0) => { vp.scrollLeft = left; vp.scrollTop = top; vp.dispatchEvent(new Event('scroll')); await flush(); };
  return { wb, id, grid, vp, pe, scrollTo };
}

/** Wait (up to a second) for the drag's auto-scroll to bring the frozen pane back. */
async function until(test) {
  for (let i = 0; i < 100; i++) { if (test()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return test();
}

// A frozen pane is drawn over the scrolling cells, so the pointer inside it is on a frozen cell far
// from the one a drag left behind. Following it made the drag leap across every column in between —
// a fill wrote over cells that were never on screen, and the columns skipped could never be dragged
// to at all, because the pane never scrolled back.
describe('a drag pulled back onto a frozen pane', () => {
  it('stops a fill at the pane edge instead of filling over the frozen cells', async () => {
    const { wb, id, grid, vp, pe } = await mount((w, i) => {
      w.setInput(i, 2, 0, 'keepA');
      w.setInput(i, 2, 1, 'keepB');
      w.setInput(i, 2, 16, 'seed');
      w.setFrozen(i, 0, 2);
    });
    grid.setRanges([{ r1: 2, c1: 16, r2: 2, c2: 16 }]);
    vp.scrollLeft = 1000; // the scrolling pane starts at column M, right of the 200px frozen band
    vp.dispatchEvent(new Event('scroll'));
    await flush();
    pe(vp, 'pointerdown', 700, ROW3_BOTTOM); // Q3's fill handle
    pe(vp, 'pointermove', 100, ROW3_Y); // over column B, as the frozen band draws it
    pe(vp, 'pointerup', 100, ROW3_Y);
    await flush();
    expect(grid.range).toEqual({ r1: 2, c1: 12, r2: 2, c2: 16 }); // M3:Q3, the columns on show
    expect(wb.getValue(id, 2, 1)).toBe('keepB');
    expect(wb.getValue(id, 2, 0)).toBe('keepA');
    expect(wb.getValue(id, 2, 5)).toBe(null); // F3, never on screen, never written
    expect(wb.getValue(id, 2, 12)).toBe('seed');
  });

  it('stops a selection at the pane edge and scrolls the pane back to reach further', async () => {
    const { grid, vp, pe } = await mount((w, i) => { w.setFrozen(i, 0, 2); });
    grid.setRanges([{ r1: 2, c1: 16, r2: 2, c2: 16 }]);
    vp.scrollLeft = 1000;
    vp.dispatchEvent(new Event('scroll'));
    await flush();
    pe(vp, 'pointerdown', 650, ROW3_Y);
    pe(vp, 'pointermove', 250, ROW3_Y);
    expect(grid.range).toEqual({ r1: 2, c1: 12, r2: 2, c2: 16 });
    pe(vp, 'pointermove', 100, ROW3_Y);
    expect(grid.range).toEqual({ r1: 2, c1: 12, r2: 2, c2: 16 }); // not B:Q
    expect(await until(() => vp.scrollLeft < 1000 && grid.range.c1 < 12)).toBe(true);
    pe(vp, 'pointerup', 100, ROW3_Y);
  });

  it('stops a selection at a frozen row band and scrolls it back', async () => {
    const { grid, vp, pe } = await mount((w, i) => { w.setFrozen(i, 2, 0); });
    const top = 15 * ROW;
    vp.scrollTop = top; // the scrolling pane starts at row 18, below the two-row frozen band
    vp.dispatchEvent(new Event('scroll'));
    await flush();
    pe(vp, 'pointerdown', 150, 21.5 * ROW - top); // row 22
    expect(grid.range.r2).toBe(21);
    pe(vp, 'pointermove', 150, ROW / 2); // over row 1, as the frozen band draws it
    expect(grid.range.r1).toBe(17);
    expect(await until(() => vp.scrollTop < top && grid.range.r1 < 17)).toBe(true);
    pe(vp, 'pointerup', 150, ROW / 2);
  });

  it('stops a column-header drag at the pane edge', async () => {
    const { grid, vp, pe } = await mount((w, i) => { w.setFrozen(i, 0, 2); });
    const clip = grid.el.querySelector('.grid-colhead-clip');
    vp.scrollLeft = 1000;
    vp.dispatchEvent(new Event('scroll'));
    await flush();
    const head = clip.querySelector('.hcell[data-c="16"]');
    pe(head, 'pointerdown', 700, 10);
    pe(clip, 'pointermove', 100, 10);
    expect(grid.range.c1).toBe(12);
    expect(grid.range.c2).toBe(16);
    pe(clip, 'pointerup', 100, 10);
  });

  it('lets a drag begun inside the band sweep the frozen cells, and one on an unscrolled pane reach them', async () => {
    const { grid, vp, pe, scrollTo } = await mount((w, i) => { w.setFrozen(i, 0, 2); });
    grid.setRanges([{ r1: 2, c1: 0, r2: 2, c2: 0 }]);
    await scrollTo(1000, 0);
    pe(vp, 'pointerdown', 50, ROW3_Y); // A3, inside the frozen band
    pe(vp, 'pointermove', 150, ROW3_Y);
    expect(grid.range).toEqual({ r1: 2, c1: 0, r2: 2, c2: 1 });
    pe(vp, 'pointerup', 150, ROW3_Y);

    await scrollTo(0, 0);
    grid.setRanges([{ r1: 2, c1: 5, r2: 2, c2: 5 }]);
    pe(vp, 'pointerdown', 550, ROW3_Y);
    pe(vp, 'pointermove', 100, ROW3_Y); // the pane is home: column B is where it looks
    expect(grid.range).toEqual({ r1: 2, c1: 1, r2: 2, c2: 5 });
    pe(vp, 'pointerup', 100, ROW3_Y);
  });

  it('leaves a drag on a sheet with no frozen pane alone', async () => {
    const { grid, vp, pe } = await mount();
    grid.setRanges([{ r1: 2, c1: 5, r2: 2, c2: 5 }]);
    pe(vp, 'pointerdown', 550, ROW3_Y);
    pe(vp, 'pointermove', 150, ROW3_Y);
    expect(grid.range).toEqual({ r1: 2, c1: 1, r2: 2, c2: 5 });
    pe(vp, 'pointerup', 150, ROW3_Y);
  });
});
