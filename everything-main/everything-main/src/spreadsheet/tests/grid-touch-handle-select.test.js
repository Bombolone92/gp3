// @vitest-environment jsdom
import { it, expect, beforeEach } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const ROW5_Y = 4.5 * ROW; // the middle of row 5

const flush = () => new Promise((r) => setTimeout(r, 5));

// On a touch screen a plain drag scrolls, so the fill handle is the way to
// drag out a range. It used to run the fill instead, writing the first cell's
// value over every cell the finger swept.
it('extends the selection from the handle on touch instead of filling', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Name');
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  grid.viewport.setPointerCapture = () => {};
  grid.viewport.releasePointerCapture = () => {};
  await flush();
  try {
    const pe = (type, x, y, pointerType) => grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 5, button: 0, pointerType }));
    // A1's bottom-right corner is at (100, ROW); the handle reaches a few pixels around it.
    pe('pointerdown', 98, ROW - 2, 'touch');
    pe('pointermove', 50, ROW5_Y, 'touch');
    pe('pointerup', 50, ROW5_Y, 'touch');
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 4, c2: 0 });
    expect([1, 2, 3, 4].map((r) => wb.getValue(id, r, 0))).toEqual([null, null, null, null]);

    // With a mouse the handle still fills.
    grid.setSelection({ active: { r: 0, c: 0 }, anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } });
    pe('pointerdown', 98, ROW - 2, 'mouse');
    pe('pointermove', 50, ROW5_Y, 'mouse');
    pe('pointerup', 50, ROW5_Y, 'mouse');
    expect([1, 2, 3, 4].map((r) => wb.getValue(id, r, 0))).toEqual(['Name', 'Name', 'Name', 'Name']);
  } finally { grid.destroy(); }
});
