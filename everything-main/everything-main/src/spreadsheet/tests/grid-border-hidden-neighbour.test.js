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
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid, has: (r, c, cls) => grid.el.querySelector(`#gc-${r}-${c}`).classList.contains(cls) };
}

// A cell's top border yielded to the bottom border of the cell above it whether or not that cell
// was shown, so hiding the row above took the line away: the user had drawn two borders and saw none.
describe('a border whose neighbour on that side is hidden', () => {
  it('stays with the cell when the row above is hidden', async () => {
    const { has } = await mount((wb, id) => {
      wb.setInput(id, 1, 0, 'above');
      wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bb: true });
      wb.setInput(id, 2, 0, 'below');
      wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bt: true });
      wb.setHidden(id, 'row', [1], true);
    });
    expect(has(2, 0, 'bt')).toBe(true);
  });

  it('stays with the cell when the column to its left is hidden', async () => {
    const { has } = await mount((wb, id) => {
      wb.setInput(id, 0, 1, 'left');
      wb.applyStyle(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { br: true });
      wb.setInput(id, 0, 2, 'right');
      wb.applyStyle(id, { r1: 0, c1: 2, r2: 0, c2: 2 }, { bl: true });
      wb.setHidden(id, 'col', [1], true);
    });
    expect(has(0, 2, 'bl')).toBe(true);
  });

  it('resolves a tie at the nearest shown neighbor in favor of the lower cell', async () => {
    const { has } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'top');
      wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bb: true });
      wb.setInput(id, 3, 0, 'below');
      wb.applyStyle(id, { r1: 3, c1: 0, r2: 3, c2: 0 }, { bt: true });
      wb.setHidden(id, 'row', [1, 2], true);
    });
    expect(has(0, 0, 'bb')).toBe(false);
    expect(has(3, 0, 'bt')).toBe(true);
  });

  it('keeps the lower cell\'s border when a shown neighbor has the same weight', async () => {
    const { has } = await mount((wb, id) => {
      wb.setInput(id, 1, 0, 'above');
      wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bb: true });
      wb.setInput(id, 2, 0, 'below');
      wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bt: true });
    });
    expect(has(2, 0, 'bt')).toBe(true);
  });
});
