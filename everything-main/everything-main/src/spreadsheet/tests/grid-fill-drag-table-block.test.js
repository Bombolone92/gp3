// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false; };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const rowMid = (r) => r * ROW + ROW / 2; // the middle of 0-based row r

/** A5:C5 is the last row of a table over A1:C5; columns are 100px wide and rows ROW px tall. */
async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, r === 0 ? `H${c}` : `${r}-${c}`);
  wb.addTable(id, { r1: 0, c1: 0, r2: 4, c2: 2 });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  const vp = grid.viewport;
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 });
  await flush();
  const pe = (type, x, y) => vp.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));
  const dragHandle = async (from, to) => { pe('pointerdown', 300, from); pe('pointermove', 300, to); pe('pointerup', 300, to); await flush(); };
  return { wb, id, grid, dragHandle, table: () => wb.sheet(id).tables[0].range };
}

// The release of a fill-handle drag offered the workbook only the rows below the cells dragged
// from, so a drag that began above a table's last row and ran past it described a block starting
// inside the table and the rows written stayed outside it. The whole block filled is offered now,
// and the workbook decides which table, if any, it belongs under.
describe('the block a fill-handle drag offers a table', () => {
  it('is the whole block filled, not the part below the cells dragged from', async () => {
    const { wb, grid, dragHandle } = await mount();
    const offered = [];
    const extend = wb.extendTableToCover.bind(wb);
    wb.extendTableToCover = (sheetId, range) => { offered.push({ ...range }); return extend(sheetId, range); };
    grid.setRanges([{ r1: 2, c1: 0, r2: 3, c2: 2 }]); // A3:C4, two rows inside the table
    await flush();
    await dragHandle(4 * ROW, rowMid(8)); // the handle at the bottom of row 4, pulled down to row 9
    expect(offered.at(-1)).toEqual({ r1: 2, c1: 0, r2: 8, c2: 2 });
  });

  it('still pulls the rows in when the drag starts on the last row of the table', async () => {
    const { grid, dragHandle, table } = await mount();
    grid.setRanges([{ r1: 4, c1: 0, r2: 4, c2: 2 }]);
    await flush();
    await dragHandle(5 * ROW, rowMid(8)); // the handle at the bottom of row 5, pulled down to row 9
    expect(table()).toEqual({ r1: 0, c1: 0, r2: 8, c2: 2 });
  });
});
