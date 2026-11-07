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

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100% (the grid snaps rows to whole pixels)
const flush = () => new Promise((r) => setTimeout(r, 5));

async function setup(prepare = () => {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.ensureSize(id, 4000, 30);
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  const boxes = () => [...grid.el.querySelector('.grid-canvas > .ref-layer').children].map((n) => n.dataset.color);
  const scrollTo = async (row) => { grid.viewport.scrollTop = row * ROW; grid.viewport.dispatchEvent(new Event('scroll')); await flush(); };
  return { wb, id, grid, boxes, scrollTo };
}

// Every reference in the formula got a highlight box on every keystroke and every scroll frame,
// wherever it was on the sheet, which made a long formula slow to type into.
it('draws highlight boxes only for the references in view, in their own colors, following the scroll', async () => {
  const { grid, boxes, scrollTo } = await setup();
  grid.beginEdit({ text: '=A1+A3000+B2+C3500', mode: 'type' });
  expect(boxes()).toEqual(['1', '3']);
  await scrollTo(2995);
  expect(boxes()).toEqual(['2']);
  await scrollTo(3495);
  expect(boxes()).toEqual(['4']);
  grid.destroy();
});

it('keeps the box of a reference in a frozen pane wherever the sheet is scrolled', async () => {
  const { grid, boxes, scrollTo } = await setup((wb, id) => wb.setFrozen(id, 1, 0));
  grid.beginEdit({ text: '=A1+A3000+B2', mode: 'type' });
  expect(boxes()).toEqual(['1', '3']);
  await scrollTo(2995);
  expect(boxes()).toEqual(['1', '2']);
  grid.destroy();
});

it('gives a range named more than once one box, in the color of its first mention', async () => {
  const { grid, boxes } = await setup();
  grid.beginEdit({ text: '=A1+B2+A1+A1:B2', mode: 'type' });
  expect(boxes()).toEqual(['1', '2', '4']);
  grid.destroy();
});
