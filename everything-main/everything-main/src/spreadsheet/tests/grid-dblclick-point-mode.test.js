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
it('keeps picking references when a cell is double-clicked while a formula wants one', async () => {
  const { wb, id, grid, viewport } = setup({ '1,1': '5' });
  await flush();
  grid.beginEdit({ text: '=', mode: 'type' });
  const target = document.getElementById('gc-1-1');
  const box = target.getBoundingClientRect();
  const down = new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: box.left + 5, clientY: box.top + 5 });
  viewport.dispatchEvent(down);
  viewport.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: box.left + 5, clientY: box.top + 5 }));
  viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: box.left + 5, clientY: box.top + 5 }));
  expect(grid.editing).toBe(true);
  expect(wb.getCell(id, 0, 0)).toBeFalsy();
  expect(grid.active).toEqual({ r: 0, c: 0 });
  grid.destroy();
});
