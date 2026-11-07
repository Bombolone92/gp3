// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
});
afterEach(() => document.body.replaceChildren());

it('draws a conditional marker on empty cells and keeps its color separate from the task borders', async () => {
  const range = { r1: 0, c1: 1, r2: 2, c2: 1 };
  const wb = new Workbook({ sheets: [{ name: 'Schedule', gridlines: false,
    cells: { '0,0': { v: null, s: { br: true, bc: '#dddddd' } }, '1,1': { v: null, s: { bt: true, bb: true, bl: true, br: true, bc: '#dddddd' } } },
    rules: [
      { range, type: 'formula', value: 'TRUE()', stopIfTrue: false, style: { bl: true, br: true, bc: '#ff00ff', blBorder: { bc: '#ff00ff' }, brBorder: { bc: '#ff00ff' } } },
      { range, type: 'formula', value: 'TRUE()', stopIfTrue: true, style: { bg: '#a37efa', bt: true, bb: true, bl: false, br: false, bc: '#f2f2f2', btBorder: { bc: '#f2f2f2' }, bbBorder: { bc: '#f2f2f2' } } },
    ],
  }] });
  const id = wb.activeSheetId;
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await new Promise(resolve => setTimeout(resolve, 10));
  for (const r of [0, 1, 2]) {
    const cell = grid.el.querySelector(`#gc-${r}-1`);
    expect(cell.style.borderLeftColor).toBe('rgb(255, 0, 255)');
    expect(cell.style.borderRightColor).toBe('rgb(255, 0, 255)');
    expect(cell.style.borderTopColor).toBe('rgb(242, 242, 242)');
    expect(cell.style.backgroundColor).toBe('rgb(163, 126, 250)');
  }
  const table = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 2, c2: 1 } });
  const cell = table.querySelectorAll('tbody tr')[1].querySelectorAll('td')[1];
  expect(cell.style.borderLeftColor).toBe('rgb(255, 0, 255)');
  expect(cell.style.borderTopColor).toBe('rgb(242, 242, 242)');
  grid.destroy();
});
