// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const flush = () => new Promise((r) => setTimeout(r, 5));

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '2');
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid };
}
const chart = (wb, id, anchor, w, h) => wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor, w, h });
const layerOf = (grid, chartId) => grid.el.querySelector(`.chart-box[data-chart="${chartId}"]`).closest('.frz-layer, .grid-objects').className;

// Eight frozen rows are 160px tall and three frozen columns 300px wide (rows ROW px on screen,
// columns 100px), room for the 150px-tall charts below; a chart is never smaller than 160 by 120.
const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const FROZEN_ROWS = 8; // FROZEN_ROWS * ROW = 160px, taller than the 150px charts that must fit inside
describe('a chart inside a frozen band', () => {
  it('is drawn in the frozen layer so it stays put with its anchor, and comes back when the freeze goes', async () => {
    const { wb, id, grid } = setup();
    wb.setFrozen(id, FROZEN_ROWS, 3);
    const inRows = chart(wb, id, { r: 0, c: 3 }, 200, 150);
    const inCols = chart(wb, id, { r: FROZEN_ROWS + 1, c: 0 }, 250, 150);
    const inCorner = chart(wb, id, { r: 0, c: 0 }, 250, 150);
    const spanning = chart(wb, id, { r: 1, c: 4 }, 200, 300); // anchored in the frozen rows but reaching well below them
    await flush();
    expect(layerOf(grid, inRows)).toContain('frz-rows');
    expect(layerOf(grid, inCols)).toContain('frz-cols');
    expect(layerOf(grid, inCorner)).toContain('frz-corner');
    expect(layerOf(grid, spanning)).toBe('grid-objects');
    wb.setFrozen(id, 0, 0);
    await flush();
    for (const c of [inRows, inCols, inCorner, spanning]) expect(layerOf(grid, c)).toBe('grid-objects');
    grid.destroy();
  });

  it('can still be dragged to a new anchor from there', async () => {
    const { wb, id, grid } = setup();
    wb.setFrozen(id, FROZEN_ROWS, 0);
    const chartId = chart(wb, id, { r: 0, c: 3 }, 200, 150);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    expect(box.closest('.frz-rows')).not.toBeNull();
    for (const [type, x, y] of [['pointerdown', 350, 30], ['pointermove', 550, 30], ['pointerup', 550, 30]]) {
      box.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, button: 0, pointerType: 'mouse' }));
    }
    expect(wb.chartById(id, chartId).anchor).toEqual({ r: 0, c: 5 });
    await flush();
    expect(grid.el.querySelector('.chart-box').closest('.frz-rows')).not.toBeNull();
    grid.destroy();
  });
});
