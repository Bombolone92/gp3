// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';

const ROW = Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100%
const ROW1_Y = ROW / 2; // the middle of row 1
const ROW2_Y = 1.5 * ROW; // the middle of row 2

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
  const opened = [];
  const grid = createGrid({ wb, sheetId: id, onListOpen: (o) => opened.push(['list', o.r, o.c]), onFilterOpen: (o) => opened.push(['filter', o.r, o.c]) });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  const tap = (x, y) => {
    for (const type of ['pointerdown', 'pointerup']) grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0, pointerType: 'touch' }));
  };
  return { wb, id, grid, opened, tap };
}

// A finger on a cell's dropdown chevron or filter button only selected the cell, because the
// buttons were looked for on mouse presses alone and a tap's release only selected or edited.
describe('a tap on a cell button', () => {
  it.each([false, true])('opens the list picker of a dropdown cell (chips=%j)', chips => {
    const { grid, opened, tap } = mount((wb, id) => { wb.addValidation(id, { range: { r1: 1, c1: 0, r2: 1, c2: 0 }, type: 'list', source: 'Yes,No', chips }); });
    // The middle of the cell just selects it.
    tap(30, ROW2_Y);
    expect(opened).toEqual([]);
    expect(grid.active).toEqual({ r: 1, c: 0 });
    expect(grid.editing).toBe(false);
    // Chips keep their inline chevron; plain cells use the outside button.
    if (chips) tap(92, ROW2_Y);
    else {
      vi.runOnlyPendingTimers();
      const button = grid.el.querySelector('.cell-list-button');
      expect(button.hidden).toBe(false);
      for (const type of ['pointerdown', 'pointerup']) button.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', button: 0 }));
      button.click();
    }
    expect(opened).toEqual([['list', 1, 0]]);
    expect(grid.editing).toBe(false);
    // A second tap in the middle of the active cell still edits it.
    tap(30, ROW2_Y);
    expect(grid.editing).toBe(true);
    grid.cancelEdit();
  });

  it('opens the filter menu of a header cell', () => {
    const { opened, tap } = mount((wb, id) => {
      wb.setInput(id, 0, 0, 'Head');
      wb.setInput(id, 1, 0, 'a');
      wb.setFilterRange(id, { r1: 0, c1: 0, r2: 1, c2: 0 });
    });
    tap(92, ROW1_Y);
    expect(opened).toEqual([['filter', 0, 0]]);
  });
});
