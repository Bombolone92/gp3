// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
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

/**
 * Log the grid's layout reads (the viewport's scroll offsets and size) and its DOM writes
 * (children replaced or appended anywhere in the grid) in the order they happen.
 */
async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'Name');
  wb.setInput(id, 1, 0, 'Apples');
  prepare?.(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(2, 2));
  await flush();
  const log = [];
  for (const [name, value] of [['scrollLeft', 0], ['scrollTop', 0], ['clientWidth', 800], ['clientHeight', 400]]) {
    Object.defineProperty(grid.viewport, name, { configurable: true, get: () => { log.push(`R:${name}`); return value; }, set() {} });
  }
  const write = (kind) => function patched(...args) {
    if (grid.el.contains(this) || this === grid.el) log.push(`W:${kind}(${this.className.split(' ')[0] || this.tagName.toLowerCase()})`);
    return original[kind].apply(this, args);
  };
  const original = { replaceChildren: Element.prototype.replaceChildren, append: Element.prototype.append };
  Element.prototype.replaceChildren = write('replaceChildren');
  Element.prototype.append = write('append');
  const restore = () => { Element.prototype.replaceChildren = original.replaceChildren; Element.prototype.append = original.append; };
  return { wb, id, grid, log, restore };
}

// The frame that followed a cell edit rebuilt a couple of hundred cell nodes, then read the
// viewport's scroll offsets to place the fill handle and the popovers, forcing the browser to lay
// the new nodes out mid-frame before more writes followed; and the change handler painted the
// selection at once, so the frame painted it a second time.
describe('the frame after a cell changes', () => {
  it('reads the viewport once, before any node is written, and paints the selection once', async () => {
    const { wb, id, log, restore } = await mount();
    try {
      wb.setInput(id, 1, 1, '3');
      await flush();
      const firstWrite = log.findIndex((e) => e.startsWith('W:'));
      expect(firstWrite).toBeGreaterThan(0);
      expect(log.slice(0, firstWrite)).toEqual(expect.arrayContaining(['R:scrollLeft', 'R:scrollTop', 'R:clientWidth', 'R:clientHeight']));
      expect(log.slice(firstWrite).filter((e) => e.startsWith('R:'))).toEqual([]);
      expect(log.filter((e) => e === 'W:replaceChildren(sel-extras)')).toHaveLength(1);
      expect(log.filter((e) => e === 'W:replaceChildren(grid-cells)')).toHaveLength(1);
    } finally { restore(); }
  });

  it('holds when the sheet is scrolled and frozen panes are drawn', async () => {
    const { wb, id, log, restore } = await mount((wb, id) => { wb.setFrozen(id, 1, 1); wb.setNote(id, 2, 2, 'A note'); });
    try {
      wb.setInput(id, 3, 3, 'x');
      await flush();
      const firstWrite = log.findIndex((e) => e.startsWith('W:'));
      expect(firstWrite).toBeGreaterThan(0);
      expect(log.slice(firstWrite).filter((e) => e.startsWith('R:'))).toEqual([]);
    } finally { restore(); }
  });
});
