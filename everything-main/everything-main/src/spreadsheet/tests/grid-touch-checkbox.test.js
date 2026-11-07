// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
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
afterEach(() => { document.body.replaceChildren(); });

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const mid = (r) => r * ROW + ROW / 2; // the middle of row r on screen
const flush = () => new Promise((r) => setTimeout(r, 5));

// A click toggles a checkbox cell; a tap only selected it, and a second tap opened the editor on
// the TRUE/FALSE text, so on a touch screen the box could not be ticked at all.
it('toggles a checkbox cell on a tap, as a click does, instead of editing it on the second', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.addValidation(id, { range: { r1: 2, c1: 0, r2: 2, c2: 0 }, type: 'checkbox' });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  const tap = () => {
    for (const type of ['pointerdown', 'pointerup']) grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: mid(2), pointerId: 4, button: 0, pointerType: 'touch' }));
  };
  tap();
  expect(grid.active).toEqual({ r: 2, c: 0 });
  expect(wb.getValue(id, 2, 0)).toBe(true);
  expect(grid.editing).toBe(false);
  tap();
  expect(wb.getValue(id, 2, 0)).toBe(false);
  expect(grid.editing).toBe(false);
  // A checkbox driven by a formula keeps its value; the tap still only selects it.
  wb.setInput(id, 2, 0, '=1=1');
  tap();
  expect(wb.getCell(id, 2, 0).f).toBe('1=1');
  expect(grid.editing).toBe(false);
  grid.destroy();
});

// The same on the mouse path: the two clicks tick the box twice, which changes nothing, but the
// double-click that followed them opened the in-cell editor over the drawn box on its TRUE/FALSE.
it('opens no editor when a checkbox cell is double-clicked, leaving the two clicks to cancel out', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'TRUE');
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'checkbox' });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  const click = () => {
    for (const type of ['pointerdown', 'pointerup']) grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: 50, clientY: mid(0), pointerId: 1, button: 0, pointerType: 'mouse' }));
  };
  click();
  click();
  grid.viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 50, clientY: mid(0) }));
  await flush();
  expect(grid.editing).toBe(false);
  expect(wb.getValue(id, 0, 0)).toBe(true); // ticked off and back on
  expect(grid.active).toEqual({ r: 0, c: 0 });
  grid.destroy();
});
