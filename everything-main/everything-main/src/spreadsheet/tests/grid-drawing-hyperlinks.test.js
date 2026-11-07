// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const mod = { ctrlKey: true, metaKey: true };


async function setup(url = '#Sheet2!B3') {
  const wb = new Workbook(), sid = wb.activeSheetId;
  const id = wb.addChart(sid, { type: 'text', text: 'Navigate', anchor: { r: 2, c: 2 }, w: 200, h: 60, hyperlink: url });
  const commands = [], grid = createGrid({ wb, sheetId: sid, onCommand: (...args) => commands.push(args) });
  document.body.replaceChildren(grid.el); await flush();
  return { wb, sid, id, grid, commands, box: grid.el.querySelector(`[data-chart="${id}"]`) };
}
function pointer(box, type, init = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 220, clientY: 80, ...init });
  Object.defineProperty(event, 'pointerId', { value: 1 }); box.dispatchEvent(event);
}
it('follows a drawing link on click and Enter, with an accessible Open link control', async () => {
  const { grid, box, commands, id } = await setup();
  pointer(box, 'pointerdown'); pointer(box, 'pointerup');
  expect(commands).toEqual([['openDrawingLink', id]]);
  key(grid.viewport, 'Enter'); expect(commands.at(-1)).toEqual(['openDrawingLink', id]);
  const button = box.querySelector('[aria-label="Open link"]');
  expect(button.hidden).toBe(false); button.click(); expect(commands).toHaveLength(3);
  grid.destroy();
});
it.each(['shift', 'drag', 'cancel', 'resize'])('does not navigate during %s', async action => {
  const { grid, box, commands } = await setup();
  const target = action === 'resize' ? box.querySelector('.chart-resize') : box;
  pointer(target, 'pointerdown', { shiftKey: action === 'shift' });
  if (action === 'drag') pointer(box, 'pointermove', { clientX: 250 });
  pointer(box, action === 'cancel' ? 'pointercancel' : 'pointerup');
  expect(commands).toEqual([]); grid.destroy();
});
it.each(['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,hello', 'file:///tmp/example'])('does not activate unsafe or unsupported target %s', async url => {
  const { grid, box, commands } = await setup(url);
  expect(box.querySelector('[aria-label="Open link"]').hidden).toBe(true);
  pointer(box, 'pointerdown'); pointer(box, 'pointerup');
  expect(commands).toEqual([]);
  key(grid.viewport, 'Enter'); expect(commands[0][0]).toBe('editChart'); grid.destroy();
});
