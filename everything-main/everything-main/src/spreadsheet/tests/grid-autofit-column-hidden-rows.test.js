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
const autofit = (grid, c) => grid.el.querySelector(`.col-resizer[data-c="${c}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

// Double-clicking a column's edge sizes the column to the rows on show, as Format → Fit columns to
// content does since it learnt to leave hidden and filtered-out rows out: a long note in a hidden row
// must not widen the column for nothing on show.
it('sizes a column to the rows on show, leaving hidden and filtered-out rows out', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Item');
  wb.setInput(id, 1, 0, 'Apple');
  wb.setInput(id, 2, 0, 'A very long note nobody can see while its row is hidden');
  wb.setInput(id, 3, 0, 'Fig');
  wb.setHidden(id, 'row', [2], true);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  autofit(grid, 0);
  expect(wb.colWidth(id, 0)).toBe(5 * 7 + 14); // "Apple", the widest cell on show
  wb.setHidden(id, 'row', [2], false);
  autofit(grid, 0);
  expect(wb.colWidth(id, 0)).toBeGreaterThan(40 * 7);
  // A filter hiding the row leaves it out the same way.
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 0 });
  wb.setFilterCriteria(id, 0, { op: 'values', values: ['Apple', 'Fig'] });
  autofit(grid, 0);
  expect(wb.colWidth(id, 0)).toBe(4 * 7 + 14 + 18); // the header "Item" plus its filter button's room, wider than "Apple"; the long note stays out
  grid.destroy();
});
