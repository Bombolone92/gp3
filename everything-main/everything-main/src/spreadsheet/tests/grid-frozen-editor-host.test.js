// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid, COL_HEADER_H } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { stylesheet, declared } from './helpers/css.js';

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

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const flush = () => new Promise((r) => setTimeout(r, 5));

/** The row headers are 48px wide and the column headers COL_HEADER_H tall; rows are ROW, columns 100px. */
async function mount(rows, cols) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setFrozen(id, rows, cols);
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  const scroll = { left: 0, top: 0 };
  Object.defineProperty(grid.viewport, 'scrollLeft', { configurable: true, get: () => scroll.left, set: (v) => { scroll.left = v; } });
  Object.defineProperty(grid.viewport, 'scrollTop', { configurable: true, get: () => scroll.top, set: (v) => { scroll.top = v; } });
  await flush();
  const scrollTo = (left, top) => { scroll.left = left; scroll.top = top; grid.viewport.dispatchEvent(new Event('scroll')); };
  const editor = grid.el.querySelector('.grid-editor');
  return { wb, id, grid, scrollTo, editor };
}

// The editor of a frozen cell was moved into the frozen pane's clipped layer: an entry of several
// lines in a frozen row was cut at the pane's bottom, and a long one in a frozen column at the
// pane's right edge, while it was typed. The editor now runs across into the
// scrolling part of the sheet.
describe('the in-cell editor of a frozen cell', () => {
  it('is hosted by the grid outside the pane and grows past the frozen rows', async () => {
    const { grid, editor } = await mount(3, 0); // a pane three rows tall
    grid.setSelection(S.single(0, 0));
    grid.beginEdit({ text: 'a\nb\nc\nd\ne\nf\ng' });
    expect(editor.parentNode).toBe(grid.el);
    expect(editor.closest('.frz-layer')).toBeNull();
    expect(editor.style.left).toBe('48px');
    expect(editor.style.top).toBe(`${COL_HEADER_H}px`);
    expect(parseFloat(editor.style.height)).toBeGreaterThan(3 * ROW);
    grid.destroy();
  });

  it('runs past the frozen column, as far as the viewport allows', async () => {
    const { grid, editor } = await mount(0, 1); // a 100px pane
    grid.setSelection(S.single(0, 0));
    grid.beginEdit({ text: 'x'.repeat(60) });
    expect(editor.parentNode).toBe(grid.el);
    expect(editor.style.width).toBe('436px'); // 60 × 7px and the editor's own padding
    grid.destroy();
  });

  it('follows the cell along its free axis at once when the sheet scrolls', async () => {
    const { grid, editor, scrollTo } = await mount(0, 1);
    grid.setSelection(S.single(4, 0)); // A5, in the frozen column
    grid.beginEdit({ text: 'x' });
    expect(editor.style.left).toBe('48px');
    expect(editor.style.top).toBe(`${COL_HEADER_H + 4 * ROW}px`); // below the column header and four rows
    scrollTo(0, 30);
    expect(editor.style.top).toBe(`${COL_HEADER_H + 4 * ROW - 30}px`);
    scrollTo(250, 30); // the frozen column does not scroll sideways
    expect(editor.style.left).toBe('48px');
    grid.destroy();
  });

  it('goes back into the canvas when the entry ends, and a cell outside the panes keeps it there', async () => {
    const { grid, editor } = await mount(1, 1);
    const canvas = grid.el.querySelector('.grid-canvas');
    grid.setSelection(S.single(0, 0));
    grid.beginEdit({ text: 'x' });
    expect(editor.parentNode).toBe(grid.el);
    grid.cancelEdit();
    expect(editor.parentNode).toBe(canvas);
    grid.setSelection(S.single(4, 2)); // C5, in the scrolling part
    grid.beginEdit({ text: 'x' });
    expect(editor.parentNode).toBe(canvas);
    expect(editor.style.left).toBe('200px'); // canvas coordinates
    expect(editor.style.top).toBe(`${4 * ROW}px`);
    grid.destroy();
  });

  it('paints over the panes, where the grid hosts it', () => {
    const css = stylesheet('grid.css');
    const z = (selector) => Number(declared(css, selector, false)['z-index']);
    expect(z('.grid > .grid-editor')).toBeGreaterThan(z('.frz-corner'));
  });
});
