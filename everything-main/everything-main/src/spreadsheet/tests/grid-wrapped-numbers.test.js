// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { stylesheet, declared } from './helpers/css.js';
import { heightForLines } from '../src/core/textfit.js';

/** The height a row fitted to one line of 13px text takes (never less than the default row). */
const ONE_LINE = heightForLines(1, 13, DEFAULT_ROW_HEIGHT);

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

/** Column A is `width` px wide and wraps its text. */
async function mount(width, prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setColWidth(id, 0, width);
  prepare(wb, id);
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 3, c2: 0 }, { wrap: true });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid, node: (r) => grid.el.querySelector(`#gc-${r}-0`) };
}

// With Wrap text on, a number too wide for its column was broken across lines ("1234 / 5678 / 9012")
// and Fit row height grew the row for the pieces: a number read as three lines of digits is a misread
// value. A number never wraps now: one that does not fit shows ### (or a shorter General form).
describe('a number in a wrapped cell', () => {
  it('shows ### when it does not fit, as an unwrapped number does', async () => {
    const { node } = await mount(39, (wb, id) => { wb.setInput(id, 0, 0, '123456789012'); });
    expect(node(0).classList.contains('wrap')).toBe(true);
    expect(node(0).classList.contains('num')).toBe(true);
    expect(node(0).textContent).toBe('###');
    expect(node(0).title).toBe('1.23457E+11');
  });

  it('shortens a General number to fit instead of wrapping it', async () => {
    const { node } = await mount(50, (wb, id) => { wb.setInput(id, 0, 0, '123456789012'); });
    expect(node(0).textContent).toBe('1E+11');
  });

  it('shows ### for a date that does not fit', async () => {
    const { node } = await mount(40, (wb, id) => { wb.setInput(id, 0, 0, '2026-08-28'); });
    expect(node(0).textContent).toBe('###');
  });

  it('counts as one line when the row is fitted, while wrapped text still grows the row', async () => {
    const { wb, id, grid } = await mount(40, (wb, id) => {
      wb.setInput(id, 0, 0, '123456789012');
      wb.setInput(id, 2, 0, 'several words of text');
    });
    grid.autoFitRows(0, 2);
    expect(wb.rowHeight(id, 0)).toBe(ONE_LINE);
    expect(wb.rowHeight(id, 2)).toBeGreaterThan(ONE_LINE);
  });

  it('is kept on one line by the stylesheet too', () => {
    const css = stylesheet('grid.css');
    expect(declared(css, '.cell.wrap', false)['white-space']).toBe('pre-wrap');
    expect(declared(css, '.cell.wrap.num', false)['white-space']).toBe('pre');
  });
});
