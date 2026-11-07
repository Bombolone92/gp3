// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
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
const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(8, 6)); // away from the merge, so the anchor is not drawn merely as the active cell
  await flush();
  return { wb, id, grid, node: (r, c) => grid.el.querySelector(`#gc-${r}-${c}`) };
}

// A merge's anchor was built only when its own row and column were shown, so hiding the first
// row of a merged title left a hole showing bare grid lines where the rest of the block still
// stood, with the selection box and fill handle drawn over it.
describe('a merged block whose anchor line is hidden', () => {
  it('is drawn as its visible rows, with its value and fill', async () => {
    const { grid, node } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'Title');
      wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: '#ffcc00' });
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
      wb.setHidden(id, 'row', [0], true);
    });
    const anchor = node(0, 0);
    expect(anchor).toBeTruthy();
    expect(anchor.textContent).toBe('Title');
    expect(anchor.classList.contains('merged')).toBe(true);
    expect(anchor.style.backgroundColor).toBe('rgb(255, 204, 0)');
    expect(anchor.style.width).toBe('200px');
    expect(anchor.style.height).toBe(`${2 * ROW}px`); // rows 2 and 3
    expect(anchor.parentElement.style.transform).toBe('translateY(0px)');
    for (const [r, c] of [[1, 0], [1, 1], [2, 0], [2, 1]]) expect(node(r, c), `gc-${r}-${c}`).toBeNull();
    // The selection box agrees with what is drawn.
    grid.setSelection(S.single(1, 0));
    await flush();
    expect(grid.active).toEqual({ r: 0, c: 0 });
    const active = grid.el.querySelector('.grid-canvas > .sel-active');
    expect(active.style.transform).toBe('translate(0px, 0px)');
    expect(active.style.height).toBe(`${2 * ROW}px`);
    grid.destroy();
  });

  it('is drawn as its visible columns when its first column is hidden', async () => {
    const { grid, node } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'Across');
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 2 });
      wb.setHidden(id, 'col', [0], true);
    });
    const anchor = node(0, 0);
    expect(anchor).toBeTruthy();
    expect(anchor.textContent).toBe('Across');
    expect(anchor.style.left).toBe('0px');
    expect(anchor.style.width).toBe('200px'); // columns B and C
    expect(node(0, 1)).toBeNull();
    expect(node(0, 2)).toBeNull();
    grid.destroy();
  });

  it('is drawn in a frozen pane too', async () => {
    const { grid } = await mount((wb, id) => {
      wb.setFrozen(id, 4, 0);
      wb.setInput(id, 0, 0, 'Frozen title');
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 1 });
      wb.setHidden(id, 'row', [0], true);
    });
    const copy = grid.el.querySelector('.frz-rows .frz-cells .cell.merged');
    expect(copy).toBeTruthy();
    expect(copy.textContent).toBe('Frozen title');
    expect(copy.style.height).toBe(`${2 * ROW}px`); // rows 2 and 3
    grid.destroy();
  });

  it('is left out when every one of its lines is hidden', async () => {
    const { node } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'Gone');
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
      wb.setHidden(id, 'row', [0, 1], true);
    });
    expect(node(0, 0)).toBeNull();
  });
});
