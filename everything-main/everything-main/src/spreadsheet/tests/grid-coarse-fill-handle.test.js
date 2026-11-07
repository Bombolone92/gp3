// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

let coarse = false;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  globalThis.matchMedia = (q) => ({ matches: coarse && q.includes('coarse'), addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { coarse = false; document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const flush = () => new Promise((r) => setTimeout(r, 5));
const touch = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'touch' }));

/** A1 is selected; its handle sits at (100, ROW). Press `away` px from it on touch and drag to B3. */
async function dragFrom(away) {
  const wb = new Workbook();
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id });
  document.body.replaceChildren(grid.el);
  await flush();
  touch(grid.viewport, 'pointerdown', 100 + away, ROW + away);
  touch(grid.viewport, 'pointermove', 150, 2.5 * ROW); // the middle of B3
  touch(grid.viewport, 'pointerup', 150, 2.5 * ROW);
  const range = grid.range;
  grid.destroy();
  return range;
}

describe('the fill handle on a touch screen', () => {
  it('is reached from further away than with a mouse, matching its larger drawn target', async () => {
    coarse = true;
    expect(await dragFrom(10)).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 });
    expect(await dragFrom(14)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 }); // a tap-and-scroll, not the handle
    coarse = false;
    expect(await dragFrom(10)).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
  });
});
