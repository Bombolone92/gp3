// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import { insertChart } from '../src/ui/chart-actions.js';
import { openChartDialog } from '../src/ui/chartdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

const VW = 800, VH = 400;

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return VW; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return VH; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollBy = function scrollBy() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

/** A sheet holding a block of numbers over `range`, its grid in an 800 × 400 window scrolled to (left, top). */
function setup(range, { left = 0, top = 0 } = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) wb.setInput(id, r, c, r === range.r1 ? `H${c}` : String(r + c));
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  const viewport = grid.el.querySelector('.grid-viewport');
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: VW, bottom: VH, width: VW, height: VH });
  const scroll = { left: 0, top: 0 };
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => scroll.left, set: (v) => { scroll.left = v; } });
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, get: () => scroll.top, set: (v) => { scroll.top = v; } });
  viewport.scrollTo = ({ left: l, top: t }) => { scroll.left = Math.max(0, l); scroll.top = Math.max(0, t); viewport.dispatchEvent(new Event('scroll')); };
  vi.runOnlyPendingTimers();
  viewport.scrollTo({ left, top });
  vi.runOnlyPendingTimers();
  const ctx = { wb, grid, sheetId: () => id, range: () => range };
  return { wb, id, grid, ctx, scroll };
}

/** The chart's box relative to the window. */
function onScreen(grid, scroll, chartId) {
  const box = grid.chartRect(chartId);
  return { left: box.left - scroll.left, top: box.top - scroll.top, right: box.left - scroll.left + box.width, bottom: box.top - scroll.top + box.height };
}

const inWindow = (b) => b.left >= 0 && b.top >= 0 && b.right <= VW && b.bottom <= VH;

it('keeps a new chart beside data that leaves room for it in the window', () => {
  const { grid, ctx, scroll, wb, id } = setup({ r1: 0, c1: 0, r2: 3, c2: 1 });
  const chartId = insertChart(ctx);
  expect(wb.chartById(id, chartId)).toMatchObject({ anchor: { r: 0, c: 2 }, dx: 0, dy: 0 });
  expect(inWindow(onScreen(grid, scroll, chartId))).toBe(true);
  grid.destroy();
});

// A chart went right of its data whatever the window showed: beside a table wider than the window it
// was out of sight, to be scrolled to.
it('puts a chart for data wider than the window in the middle of the window', () => {
  const { grid, ctx, scroll } = setup({ r1: 0, c1: 0, r2: 3, c2: 19 });
  const b = onScreen(grid, scroll, insertChart(ctx));
  expect(inWindow(b)).toBe(true);
  expect(Math.abs((b.left + b.right) / 2 - VW / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs((b.top + b.bottom) / 2 - VH / 2)).toBeLessThanOrEqual(1);
  grid.destroy();
});

// Scrolled down a long table, the chart went by the table's first row, above the window.
it('puts a chart for a long table scrolled down in the window', () => {
  const { grid, ctx, scroll } = setup({ r1: 0, c1: 0, r2: 89, c2: 1 }, { top: 1200 });
  expect(scroll.top).toBe(1200);
  expect(inWindow(onScreen(grid, scroll, insertChart(ctx)))).toBe(true);
  grid.destroy();
});

it('places the Insert chart dialog\'s chart in the window too', () => {
  const range = { r1: 0, c1: 0, r2: 3, c2: 19 };
  const { grid, ctx, scroll, wb, id } = setup(range);
  const { panel } = openChartDialog(ctx, { range });
  panel.querySelector('form').requestSubmit();
  const chart = wb.sheet(id).charts[0];
  expect(chart.anchor.c).toBeLessThan(20);
  expect(inWindow(onScreen(grid, scroll, chart.id))).toBe(true);
  grid.destroy();
});
