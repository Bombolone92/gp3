// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const autofit = (c) => grid.el.querySelector(`.col-resizer[data-c="${c}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return { wb, id, grid, autofit };
}

describe('double-click autofit of a column', () => {
  // A title merged across A1:C1 asked column A for its whole width, and the values an array
  // formula spilled into a column were not measured at all, so the column then showed ###.
  it('ignores a cell merged across several columns', () => {
    const { wb, id, autofit } = mount((wb, id) => {
      wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 2 });
      wb.setInput(id, 0, 0, 'A very long merged title here');
      wb.setInput(id, 1, 0, 'short');
      wb.mergeCells(id, { r1: 2, c1: 0, r2: 3, c2: 0 });
      wb.setInput(id, 2, 0, 'tall merge text'); // one column wide: still counts
    });
    autofit(0);
    const width = wb.colWidth(id, 0);
    expect(width).toBeGreaterThanOrEqual(15 * 7 + 14);
    expect(width).toBeLessThan(28 * 7);
  });

  it('measures the values spilled into the column, not only the formula cell', () => {
    const { wb, id, autofit } = mount((wb, id) => {
      wb.setInput(id, 0, 3, '=SEQUENCE(3,1,1,1000000)'); // 1 in the formula cell, seven-digit numbers below it
      wb.setColWidth(id, 3, 40);
    });
    expect(wb.getValue(id, 2, 3)).toBe(2000001);
    autofit(3);
    expect(wb.colWidth(id, 3)).toBeGreaterThanOrEqual(7 * 7 + 14);
  });

  it('measures spilled values in the number format of their formula', () => {
    const { wb, id, autofit } = mount((wb, id) => {
      wb.setInput(id, 0, 4, '=SEQUENCE(2,1,1,1234567)');
      wb.applyStyle(id, { r1: 0, c1: 4, r2: 0, c2: 4 }, { fmt: 'currency', dec: 2 });
    });
    autofit(4);
    expect(wb.colWidth(id, 4)).toBeGreaterThanOrEqual('$1,234,568.00'.length * 7 + 14);
  });
});
