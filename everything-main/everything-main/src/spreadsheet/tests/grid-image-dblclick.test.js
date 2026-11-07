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
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Charts and text boxes take the double-click themselves; an image let it fall through to the
// cell under it, which opened the editor on a cell the picture covers.
it('opens the replace dialog on a double-clicked image instead of editing the cell under it', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 2, 2, 'under');
  const chartId = wb.addChart(id, { type: 'image', src: PNG, anchor: { r: 2, c: 2 }, w: 200, h: 150 });
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (c, arg) => commands.push([c, arg]) });
  document.body.replaceChildren(grid.el);
  await flush();
  const box = grid.el.querySelector(`.chart-box[data-chart="${chartId}"]`);
  box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 250, clientY: 70, pointerId: 1, button: 0, pointerType: 'mouse' }));
  box.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: 250, clientY: 70, pointerId: 1, button: 0, pointerType: 'mouse' }));
  box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 250, clientY: 70 }));
  await flush();
  expect(grid.editing).toBe(false);
  expect(grid.selectedChart).toBe(chartId);
  expect(commands).toEqual([['replaceImage', chartId]]);
  grid.destroy();
});
