// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

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

// Auto-fit measured a rotated label flat, sizing the column to the whole text (203px for a
// 27-character label standing on end), while fitting the row already turned the bounding box.
it('fits a column to the turned bounding box of rotated text', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const label = 'A fairly long rotated label'; // 27 characters: 189px flat
  for (const [c, rot] of [[0, 90], [1, 45], [2, -60]]) {
    wb.setInput(id, 0, c, label);
    wb.applyStyle(id, { r1: 0, c1: c, r2: 0, c2: c }, { rot });
  }
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  const autofit = (c) => grid.el.querySelector(`.col-resizer[data-c="${c}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const turned = (deg) => { const rad = (Math.abs(deg) * Math.PI) / 180; return Math.ceil(189 * Math.cos(rad) + 13 * 1.3 * Math.sin(rad) + 14); };
  autofit(0);
  autofit(1);
  autofit(2);
  expect(wb.colWidth(id, 0)).toBe(40); // a vertical label asks only for its line height, under the narrowest fit
  expect(wb.colWidth(id, 1)).toBe(turned(45));
  expect(wb.colWidth(id, 2)).toBe(turned(-60));
  grid.destroy();
});
