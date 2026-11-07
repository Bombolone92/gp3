// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

let measures = 0;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => { measures++; return { width: t.length * 7 }; }, font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });
const flush = () => new Promise((r) => setTimeout(r, 5));

it('does not measure the same text twice across renders', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < 15; r++) for (let c = 0; c < 6; c++) wb.setInput(id, r, c, `Item ${r}-${c} with some text`);
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  const first = measures;
  expect(first).toBeGreaterThan(0);
  // An edit far below the viewport rebuilds it; nothing on screen needs measuring again.
  wb.setInput(id, 90, 0, 'far away');
  await flush();
  grid.refresh();
  await flush();
  expect(measures).toBe(first);
  grid.destroy();
});
