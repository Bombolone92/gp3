// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const ROW3_Y = 2.5 * ROW; // the middle of row 3
const ROW4_Y = 3.5 * ROW; // the middle of row 4

const flush = () => new Promise((r) => setTimeout(r, 5));
const press = (target, type, x, y, button) => {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button, pointerType: 'mouse' });
  target.dispatchEvent(e);
  return e;
};

async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const grid = createGrid({ wb, sheetId: id, announce() {}, onContextMenu() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid };
}

// A press with the middle button selected the cell under it and was prevented, though browsers
// use that button for their own autoscroll and paste; only the primary
// button selects (the secondary one opens the menu through its own event).
describe('a middle-button press', () => {
  it('neither selects the cell nor starts a drag, and is left to the browser', async () => {
    const { grid } = await mount();
    const down = press(grid.viewport, 'pointerdown', 250, ROW3_Y, 1); // C3
    expect(down.defaultPrevented).toBe(false);
    expect(grid.active).toEqual({ r: 0, c: 0 });
    press(grid.viewport, 'pointermove', 350, ROW4_Y, 1);
    press(grid.viewport, 'pointerup', 350, ROW4_Y, 1);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
    grid.destroy();
  });

  it('on a header selects nothing either, while the primary button still does', async () => {
    const { grid } = await mount();
    const head = grid.el.querySelector('.grid-colhead-clip .hcell[data-c="2"]');
    press(head, 'pointerdown', 250, 13, 1);
    press(head, 'pointerup', 250, 13, 1);
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
    press(head, 'pointerdown', 250, 13, 0);
    press(head, 'pointerup', 250, 13, 0);
    expect(grid.range.c1).toBe(2);
    expect(grid.range.c2).toBe(2);
    grid.destroy();
  });

  it('with the primary button still selects, as before', async () => {
    const { grid } = await mount();
    const down = press(grid.viewport, 'pointerdown', 250, ROW3_Y, 0);
    expect(down.defaultPrevented).toBe(true);
    expect(grid.active).toEqual({ r: 2, c: 2 });
    press(grid.viewport, 'pointerup', 250, ROW3_Y, 0);
    grid.destroy();
  });
});
