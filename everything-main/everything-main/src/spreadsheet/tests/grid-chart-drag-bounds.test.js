// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

// A default row on screen at 100%: the grid snaps each row to whole pixels, and a chart's anchor
// offsets are measured against those on-screen rows.
const ROW = Math.round(DEFAULT_ROW_HEIGHT);

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

describe('dragging a chart past the sheet edge', () => {
  it('leaves it inside the sheet, against the edge it was dragged over', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const chartId = wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 1, c: 2 }, dx: 10, dy: 5, w: 300, h: 200 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const drag = (fromX, fromY, toX, toY) => {
      for (const [type, x, y] of [['pointerdown', fromX, fromY], ['pointermove', toX, toY], ['pointerup', toX, toY]]) {
        box.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, button: 0, pointerType: 'mouse' }));
      }
    };
    const s = wb.sheet(id);
    const right = () => { const ch = wb.chartById(id, chartId); return ch.anchor.c * 100 + ch.dx + ch.w; };
    const bottom = () => { const ch = wb.chartById(id, chartId); return ch.anchor.r * ROW + ch.dy + ch.h; };
    drag(250, 60, 9000, 60);
    expect(right()).toBe(s.cols * 100);
    expect(bottom()).toBe(1 * ROW + 5 + 200);
    drag(250, 60, 250, 9000);
    expect(bottom()).toBe(s.rows * ROW);
    expect(right()).toBe(s.cols * 100);
    // Back past the top-left corner it stops at A1, as before.
    drag(250, 60, -9000, -9000);
    expect(wb.chartById(id, chartId)).toMatchObject({ anchor: { r: 0, c: 0 }, dx: 0, dy: 0 });
    grid.destroy();
  });
});
