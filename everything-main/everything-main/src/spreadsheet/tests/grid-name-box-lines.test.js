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
it('selects whole columns and rows typed into the name box', async () => {
  const { grid, wb, id } = setup();
  await flush();
  expect(grid.selectByName('B:C')).toBe(true);
  expect(grid.range).toEqual({ r1: 0, c1: 1, r2: 1048575, c2: 2 });
  expect(grid.selectByName('a:a')).toBe(true);
  expect(grid.range).toMatchObject({ c1: 0, c2: 0, r1: 0 });
  expect(grid.selectByName('3:5')).toBe(true);
  expect(grid.range).toEqual({ r1: 2, c1: 0, r2: 4, c2: 16383 });
  expect(grid.selectByName('5:3')).toBe(true);
  expect(grid.range).toMatchObject({ r1: 2, r2: 4 });
  expect(grid.selectByName('1:150')).toBe(true);
  expect(grid.range.r2).toBe(149);
  expect(wb.sheet(id).rows).toBeGreaterThanOrEqual(150);
  expect(grid.selectByName('A1:B2')).toBe(true);
  expect(grid.selectByName('nonsense')).toBe(false);
  grid.destroy();
});
