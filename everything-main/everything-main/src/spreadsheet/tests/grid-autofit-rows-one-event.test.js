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

const flush = () => new Promise((r) => setTimeout(r, 5));

// Fit row height over a whole sheet set every row's height in one transaction, but each row announced
// itself, and the grid rebuilt its offsets for every announcement: 20,000 rows took ten seconds.
it('fits every row of a sheet with one layout announcement, and undoes it with one', { timeout: 60000 }, async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const rows = 2000;
  wb.ensureSize(id, rows + 10, 5);
  const entries = [];
  for (let r = 0; r < rows; r++) entries.push({ r, c: 2, cell: { v: 'wrapped text long enough to need a second line in this column', f: null, s: { wrap: true } } });
  wb.setCells(id, entries, 'fill');
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  const seen = [];
  const on = (e) => seen.push(e.detail.type);
  wb.addEventListener('change', on);
  grid.autoFitRows(0, rows - 1, { force: true });
  await flush();
  expect(seen).toEqual(['layout', 'history']);
  expect(wb.rowHeight(id, 0)).toBeGreaterThan(26);
  expect(wb.rowHeight(id, rows - 1)).toBe(wb.rowHeight(id, 0));
  seen.length = 0;
  wb.undo();
  await flush();
  expect(seen).toEqual(['layout', 'history']);
  expect(wb.rowHeight(id, rows - 1)).toBe(DEFAULT_ROW_HEIGHT);
  wb.removeEventListener('change', on);
  grid.destroy();
});
