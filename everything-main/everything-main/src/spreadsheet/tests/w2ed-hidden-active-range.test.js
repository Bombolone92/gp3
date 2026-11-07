// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

// Hiding the row or column of a range's active cell (Ctrl+9 on selected rows,
// a filter) collapsed the whole selection to one visible cell. The selection now
// stays: only the active cell moves, to a visible cell of the range.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));

async function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) wb.setInput(id, r, c, `${r},${c}`);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid };
}

it('keeps whole rows selected when the active row is hidden, moving the active cell to a visible row of them', async () => {
  const { wb, id, grid } = await setup();
  try {
    grid.selectByName('2:4');
    expect(grid.active).toEqual({ r: 1, c: 0 });
    wb.setHidden(id, 'row', [1], true);
    await flush();
    expect(grid.range).toMatchObject({ r1: 1, r2: 3, c1: 0 });
    expect(grid.active).toEqual({ r: 2, c: 0 });
  } finally { grid.destroy(); }
});

it('keeps a block and the other ranges of a multi-range selection, and a hidden-only range as it is', async () => {
  const { wb, id, grid } = await setup();
  try {
    grid.setRanges([{ r1: 4, c1: 3, r2: 4, c2: 3 }, { r1: 0, c1: 0, r2: 2, c2: 2 }], { r: 0, c: 1 });
    wb.setHidden(id, 'col', [1], true);
    await flush();
    expect(grid.ranges).toEqual([{ r1: 4, c1: 3, r2: 4, c2: 3 }, { r1: 0, c1: 0, r2: 2, c2: 2 }]);
    expect(grid.active).toEqual({ r: 0, c: 2 });
    // Every selected row hidden at once (Ctrl+9): the rows stay selected, so Unhide knows which they are.
    grid.selectByName('2:3');
    wb.setHidden(id, 'row', [1, 2], true);
    await flush();
    expect(grid.range).toMatchObject({ r1: 1, r2: 2 });
    expect(grid.active).toEqual({ r: 1, c: 0 });
    wb.setHidden(id, 'row', [1, 2], false);
    await flush();
    expect(grid.range).toMatchObject({ r1: 1, r2: 2 });
  } finally { grid.destroy(); }
});

it('still moves a single selected cell off a line that hides it', async () => {
  const { wb, id, grid } = await setup();
  try {
    grid.selectByName('B3');
    wb.setHidden(id, 'col', [1], true);
    await flush();
    expect(grid.active).toEqual({ r: 2, c: 2 });
    expect(grid.ranges).toEqual([{ r1: 2, c1: 2, r2: 2, c2: 2 }]);
  } finally { grid.destroy(); }
});
