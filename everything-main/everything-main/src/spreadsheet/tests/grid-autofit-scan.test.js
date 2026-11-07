// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** Count the entries walked by for-of over any Map while `fn` runs. */
function mapStepsDuring(fn) {
  const orig = Map.prototype[Symbol.iterator];
  let steps = 0;
  Map.prototype[Symbol.iterator] = function () {
    const it = orig.call(this);
    return { next: () => { const r = it.next(); if (!r.done) steps++; return r; }, [Symbol.iterator]() { return this; } };
  };
  try { fn(); } finally { Map.prototype[Symbol.iterator] = orig; }
  return steps;
}

describe('auto-fit on a large sheet', () => {
  it('sizes one row or column without walking every cell of the sheet', async () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.ensureSize(id, 2100, 26);
    for (let r = 0; r < 2000; r++) for (let c = 0; c < 10; c++) wb.setInput(id, r, c, c === 0 ? `=B${r + 1}*2` : String(r * c));
    wb.setInput(id, 5, 2, 'wrapped text long enough to need a second line here');
    wb.applyStyle(id, { r1: 5, c1: 2, r2: 5, c2: 2 }, { wrap: true });
    wb.setInput(id, 0, 10, '=SEQUENCE(3,1,100000)'); // spills into K2:K3, which the column must still size for
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const cells = wb.sheet(id).cells.size;
    expect(cells).toBeGreaterThan(20000);
    // The workbook rebuilds its own spill index after any change (a cost every blank-cell read
    // pays, rendering included); the grid's scans are measured with that index already built.
    const warm = () => wb.spillAt(id, 0, 0);

    warm();
    const rowSteps = mapStepsDuring(() => grid.autoFitRows(5, 5));
    expect(wb.rowHeight(id, 5)).toBeGreaterThan(26);
    expect(rowSteps).toBeLessThan(cells / 10);

    warm();
    const spill = vi.spyOn(wb, 'spillRangeAt');
    const colSteps = mapStepsDuring(() => grid.el.querySelector('.col-resizer[data-c="3"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(wb.colWidth(id, 3)).toBe(4 * 7 + 14); // the longest value in D is 5997
    expect(colSteps).toBeLessThan(cells / 10);
    expect(spill.mock.calls.length).toBeLessThan(cells / 10);
    spill.mockRestore();

    grid.el.querySelector('.col-resizer[data-c="10"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(wb.colWidth(id, 10)).toBe(6 * 7 + 14); // 100002, spilled from K1
    grid.destroy();
  });
});
