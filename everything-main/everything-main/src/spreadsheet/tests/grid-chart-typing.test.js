// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

function setup(cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [k, text] of Object.entries(cells)) { const [r, c] = k.split(',').map(Number); wb.setInput(id, r, c, text); }
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (cmd, arg) => commands.push([cmd, arg]) });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, commands, viewport: grid.el.querySelector('.grid-viewport') };
}
it('deselects a chart when typing starts, so Delete afterwards clears the cell rather than the chart', async () => {
  const { wb, id, grid, viewport, commands } = setup({ '0,0': '1', '1,0': '2' });
  const chartId = wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor: { r: 3, c: 3 }, width: 200, height: 120 });
  await flush();
  grid.selectChart(chartId);
  expect(grid.selectedChart).toBe(chartId);
  key(viewport, '5');
  expect(grid.selectedChart).toBe(null);
  expect(grid.editing).toBe(true);
  key(grid.el.querySelector('.grid-editor'), 'Enter');
  expect(wb.getValue(id, 0, 0)).toBe(5);
  key(viewport, 'Delete');
  expect(commands.find(([cmd]) => cmd === 'deleteChart')).toBeUndefined();
  expect(wb.sheet(id).charts).toHaveLength(1);
  grid.destroy();
});
