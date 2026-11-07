// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.scrollBy = function scrollBy() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false; };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const rowMid = (r) => r * ROW + ROW / 2; // the middle of 0-based row r

/** A grid on an 800×400 viewport at the screen's corner: columns are 100px wide, rows ROW px tall. */
async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare?.(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  const vp = grid.viewport;
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  await flush();
  const pe = (type, x, y) => vp.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));
  const scrollTo = async (left = 0, top = 0) => { vp.scrollLeft = left; vp.scrollTop = top; vp.dispatchEvent(new Event('scroll')); await flush(); };
  return { wb, id, grid, vp, pe, scrollTo };
}

// A frozen pane draws the selection's outline clipped to its own band. A selection that starts
// outside the band therefore has no outline drawn there and its own has scrolled under the pane —
// yet a 4px strip at the pane's inner edge still answered the move cursor, took the press and, on
// release, moved cells that nothing on screen showed being dragged.
describe('the selection border where a frozen pane covers it', () => {
  it('takes no move drag from the strip at a frozen column band edge', async () => {
    const { wb, id, grid, vp, pe, scrollTo } = await mount((w, i) => { w.setInput(i, 4, 2, 'moveme'); w.setFrozen(i, 0, 2); });
    grid.setRanges([{ r1: 4, c1: 2, r2: 4, c2: 2 }]); // C5, whose left border sits at 200px
    await scrollTo(600, 0); // C is off screen; the band draws A and B over 0–200px
    pe('pointermove', 198, rowMid(4));
    expect(vp.classList.contains('can-move')).toBe(false);
    pe('pointerdown', 198, rowMid(4));
    pe('pointermove', 198, rowMid(9));
    pe('pointerup', 198, rowMid(9));
    await flush();
    expect(wb.getValue(id, 4, 2)).toBe('moveme');
    expect(wb.getValue(id, 9, 2)).toBe(null);
    expect(wb.undoLabels()).not.toContain('Move cells');
    expect(grid.range).toEqual({ r1: 4, c1: 1, r2: 9, c2: 1 }); // the press selected the frozen cells shown there
  });

  it('takes no move drag from the strip at a frozen row band edge', async () => {
    const { wb, id, grid, vp, pe, scrollTo } = await mount((w, i) => { w.setInput(i, 2, 2, 'moveme'); w.setFrozen(i, 2, 0); });
    grid.setRanges([{ r1: 2, c1: 2, r2: 2, c2: 2 }]); // C3, whose top border sits at 2 * ROW, the band's bottom edge
    await scrollTo(0, 100);
    const strip = 2 * ROW - 2; // inside the band, within the border's 4px reach
    pe('pointermove', 250, strip);
    expect(vp.classList.contains('can-move')).toBe(false);
    pe('pointerdown', 250, strip);
    pe('pointermove', 550, strip);
    pe('pointerup', 550, strip);
    await flush();
    expect(wb.getValue(id, 2, 2)).toBe('moveme');
    expect(wb.undoLabels()).not.toContain('Move cells');
  });

  it('still takes hold of a selection that reaches into the band', async () => {
    const { grid, vp, pe, scrollTo } = await mount((w, i) => { w.setFrozen(i, 0, 2); });
    grid.setRanges([{ r1: 4, c1: 0, r2: 4, c2: 3 }]); // A5:D5 begins inside the frozen band
    await scrollTo(600, 0);
    pe('pointermove', 198, 4 * ROW + 2); // just below its top border, drawn across the whole band
    expect(vp.classList.contains('can-move')).toBe(true);
    pe('pointermove', 2, rowMid(4)); // its left border, at the band's own left edge
    expect(vp.classList.contains('can-move')).toBe(true);
  });

  it('still takes hold of a border sitting on the pane edge while the pane is home', async () => {
    const { grid, vp, pe } = await mount((w, i) => { w.setFrozen(i, 0, 2); });
    grid.setRanges([{ r1: 4, c1: 2, r2: 9, c2: 6 }]); // C5:G10: its left border is drawn at the split
    await flush();
    pe('pointermove', 198, rowMid(6)); // inside C5:G10's rows
    expect(vp.classList.contains('can-move')).toBe(true);
  });
});
