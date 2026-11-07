// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

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

const flush = () => new Promise((r) => setTimeout(r, 5));

// A press at the viewport's very first pixel was taken as the first column or row even when that
// line was hidden and had no width or height to press on, selecting a cell nobody could see.
it('selects the first visible column or row from a press at the viewport edge, never a hidden one', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setHidden(id, 'col', [0], true);
  wb.setHidden(id, 'row', [0, 1], true);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  const press = (x, y) => { for (const type of ['pointerdown', 'pointerup']) grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' })); };
  press(0, 0);
  expect(grid.active).toEqual({ r: 2, c: 1 });
  press(0, 13);
  expect(grid.active).toEqual({ r: 2, c: 1 });
  press(50, 0);
  expect(grid.active).toEqual({ r: 2, c: 1 });
  grid.destroy();
});
