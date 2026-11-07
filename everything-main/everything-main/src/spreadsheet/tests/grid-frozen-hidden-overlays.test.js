// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { stylesheet, declared } from './helpers/css.js';

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
const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const ROW4_MID = 3 * ROW + ROW / 2; // the middle of row 4, where the fill drags are pulled to
const pe = (target, type, x, y, init = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', ...init }));

/** Two frozen columns (200px) and the sheet scrolled `scrollLeft` to the right; the viewport's top-left is at (0, 0). */
async function mount(scrollLeft, prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setFrozen(id, 0, 2);
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  let sl = scrollLeft;
  Object.defineProperty(grid.viewport, 'scrollLeft', { configurable: true, get: () => sl, set: (v) => { sl = v; } });
  grid.viewport.dispatchEvent(new Event('scroll'));
  await flush();
  return { wb, id, grid };
}

// The frozen pane is opaque but lets pointer events through to the canvas, where an overlay
// that has scrolled under it still took the press: a click on a frozen cell filled another column.
describe('overlays scrolled under a frozen pane', () => {
  it('the fill handle does not fill from a press on the frozen cell drawn over it', async () => {
    const { wb, id, grid } = await mount(250, (wb, id) => { wb.setInput(id, 0, 3, 'x'); });
    grid.setSelection(S.single(0, 3)); // D1's handle sits at canvas x 400: 150 on screen, under frozen B
    await flush();
    const handle = grid.el.querySelector('.grid-canvas > .fill-handle');
    expect(handle.classList.contains('under-pane')).toBe(true);
    pe(handle, 'pointerdown', 150, ROW - 2); // on the handle, just inside row 1
    pe(grid.viewport, 'pointermove', 150, ROW4_MID);
    pe(grid.viewport, 'pointerup', 150, ROW4_MID);
    await flush();
    expect([1, 2, 3].map((r) => wb.getValue(id, r, 3))).toEqual([null, null, null]);
    expect(grid.active).toEqual({ r: 0, c: 1 });
    // Scrolled back, the handle is in view and fills again.
    grid.viewport.scrollLeft = 0;
    grid.viewport.dispatchEvent(new Event('scroll'));
    await flush();
    grid.setSelection(S.single(0, 3));
    await flush();
    expect(handle.classList.contains('under-pane')).toBe(false);
    pe(handle, 'pointerdown', 400, ROW); // the handle's centre, at D1's bottom-right corner
    pe(grid.viewport, 'pointermove', 400, ROW4_MID);
    pe(grid.viewport, 'pointerup', 400, ROW4_MID);
    await flush();
    expect([1, 2, 3].map((r) => wb.getValue(id, r, 3))).toEqual(['x', 'x', 'x']);
    grid.destroy();
  });

  it('gives the hidden handle no pointer events, so it shows no crosshair through the pane', () => {
    expect(declared(stylesheet('grid.css'), '.fill-handle.under-pane', false)['pointer-events']).toBe('none');
  });

  it('a chart is neither selected nor dragged from its part under the pane, while its visible part still is', async () => {
    let chartId;
    const { wb, id, grid } = await mount(450, (wb, id) => {
      wb.setInput(id, 0, 0, '1');
      wb.setInput(id, 1, 0, '2');
      chartId = wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor: { r: 0, c: 5 }, w: 300, h: 200 }); // F1: canvas x 500..800, on screen 50..350
    });
    const box = grid.el.querySelector(`.chart-box[data-chart="${chartId}"]`);
    pe(box, 'pointerdown', 150, 13);
    pe(grid.viewport, 'pointerup', 150, 13);
    await flush();
    expect(grid.selectedChart).toBeNull();
    expect(grid.active).toEqual({ r: 0, c: 1 });
    box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 150, clientY: 13 }));
    expect(grid.editing).toBe(true); // the frozen cell's editor, not the chart dialog
    grid.cancelEdit();
    pe(box, 'pointerdown', 300, 13);
    pe(box, 'pointermove', 320, 13);
    pe(box, 'pointerup', 320, 13);
    await flush();
    expect(grid.selectedChart).toBe(chartId);
    expect(wb.chartById(id, chartId).dx).toBe(20);
    grid.destroy();
  });

  it('a table corner under the pane does not start resizing the table', async () => {
    const { wb, id, grid } = await mount(250, (wb, id) => {
      [['Name', 'Qty', 'Unit'], ['a', '1', 'x'], ['b', '2', 'y']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
      wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 2 }); // its handle at canvas (291, 3 * ROW - 9): 41px on screen, under frozen A
    });
    const before = { ...wb.sheet(id).tables[0].range };
    const handle = grid.el.querySelector('.table-handle');
    pe(handle, 'pointerdown', 45, 3 * ROW - 6); // on the handle, inside row 3
    pe(grid.viewport, 'pointermove', 45, 150);
    pe(grid.viewport, 'pointerup', 45, 150);
    await flush();
    expect(wb.sheet(id).tables[0].range).toEqual(before);
    expect(grid.active).toEqual({ r: 2, c: 0 });
    grid.destroy();
  });
});
