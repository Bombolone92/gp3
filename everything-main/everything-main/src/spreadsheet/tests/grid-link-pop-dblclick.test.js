// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

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

// The link popover stopped presses from reaching the cells but not double-clicks, so
// double-clicking its address (to select it, say) opened the editor on the cell beneath it.
it('does not start editing the cell under the link popover when its text is double-clicked', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'https://example.com/reports');
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  grid.setSelection(S.single(0, 0));
  await flush();
  const url = grid.el.querySelector('.link-pop-url');
  expect(grid.el.querySelector('.link-pop').hidden).toBe(false);
  url.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
  expect(grid.editing).toBe(false);
  expect(grid.active).toEqual({ r: 0, c: 0 });
  grid.destroy();
});
