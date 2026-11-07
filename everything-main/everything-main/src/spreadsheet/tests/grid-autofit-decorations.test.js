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

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid };
}
const autofit = (grid, c) => grid.el.querySelector(`.col-resizer[data-c="${c}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
const ICONS = { r1: 0, c1: 0, r2: 2, c2: 0 };

// The test canvas measures 7px a character. A fitted column is the text plus 14px, and the
// stylesheet keeps 20px on the right of a filter header and 18px of a dropdown cell in place of
// the usual 2px, 9px each side of a chip's label, and an icon-set glyph with a 5px gap before a
// value; a column fitted without them clipped the text.
describe('auto-fit with in-cell decorations', () => {
  it('keeps room for the filter button of a header', async () => {
    const { wb, id, grid } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'Quarterly revenue');
      wb.setInput(id, 1, 0, '10');
      wb.setFilterRange(id, { r1: 0, c1: 0, r2: 1, c2: 0 });
    });
    autofit(grid, 0);
    expect(wb.colWidth(id, 0)).toBe(17 * 7 + 14 + 18);
    grid.destroy();
  });

  it('fits plain list values normally and reserves room for inline chip controls', async () => {
    const { wb, id, grid } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'Pending approval');
      wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'list', source: 'Pending approval, Done' });
      wb.setInput(id, 0, 1, 'Pending approval');
      wb.addValidation(id, { range: { r1: 0, c1: 1, r2: 0, c2: 1 }, type: 'list', source: 'Pending approval, Done', chips: true });
    });
    autofit(grid, 0);
    autofit(grid, 1);
    expect(wb.colWidth(id, 0)).toBe(16 * 7 + 14);
    expect(wb.colWidth(id, 1)).toBe(16 * 7 + 14 + 16 + 18);
    grid.destroy();
  });

  it('keeps room for an icon set\'s glyph before the value', async () => {
    const { wb, id, grid } = await mount((wb, id) => {
      ['1000000', '2000000', '3000000'].forEach((v, r) => wb.setInput(id, r, 0, v));
      wb.addRule(id, { range: ICONS, type: 'icons', set: 'arrows', style: {} });
    });
    autofit(grid, 0);
    expect(wb.colWidth(id, 0)).toBe(7 * 7 + 14 + (7 + 4)); // the glyph is one character, 1px tighter, and 5px before the number
    grid.destroy();
  });
});
