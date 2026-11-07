// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const B2_Y = ROW + ROW / 2; // the middle of row 2, under B2 inside the merge
const E5_Y = 4 * ROW + ROW / 2; // the middle of row 5

/** A1:B2 is merged (200 by 2 * ROW pixels); only its top-left 100 by ROW are the anchor's own pixels. */
async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  const opened = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onDateOpen: (p) => opened.push(p) });
  document.body.replaceChildren(grid.el);
  grid.viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  await flush();
  const dbl = (x, y) => grid.viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  return { wb, id, grid, opened, dbl };
}

// The double-click read the coordinates under the pointer, which over most of a merged block are a
// covered cell's: that cell has no style and no value, so a merged date field opened the in-cell
// text editor instead of the calendar everywhere but its own top-left corner — while Alt+Down and a
// tap on the same block opened the picker, so the ways in disagreed.
describe('a double-click on a merged block', () => {
  it('opens the calendar of a merged date cell wherever on the block it lands', async () => {
    const { grid, opened, dbl } = await mount((wb, id) => { wb.setInput(id, 0, 0, '2024-03-05'); });
    dbl(50, 10); // the anchor's own corner
    expect(opened).toEqual([{ r: 0, c: 0 }]);
    expect(grid.editing).toBe(false);
    dbl(150, B2_Y); // B2's pixels, most of the field
    expect(opened).toEqual([{ r: 0, c: 0 }, { r: 0, c: 0 }]);
    expect(grid.editing).toBe(false);
    grid.destroy();
  });

  it('leaves a merged checkbox cell alone wherever on the block it lands', async () => {
    const { grid, dbl } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'TRUE');
      wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'checkbox' });
    });
    dbl(150, B2_Y);
    expect(grid.editing).toBe(false);
    grid.destroy();
  });

  it('still opens a merged text cell for editing, on its anchor', async () => {
    const { grid, dbl } = await mount((wb, id) => { wb.setInput(id, 0, 0, 'Title'); });
    dbl(150, B2_Y);
    expect(grid.editing).toBe(true);
    expect({ r: grid.editState.r, c: grid.editState.c }).toEqual({ r: 0, c: 0 });
    expect(grid.editState.text).toBe('Title');
    grid.destroy();
  });

  it('still opens the calendar of an unmerged date cell', async () => {
    const { grid, opened, dbl } = await mount((wb, id) => { wb.setInput(id, 4, 4, '2024-03-05'); });
    dbl(450, E5_Y); // E5
    expect(opened).toEqual([{ r: 4, c: 4 }]);
    expect(grid.editing).toBe(false);
    grid.destroy();
  });
});
