// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 1, 'Qty');
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (c, arg) => commands.push([c, arg]) });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, commands, viewport: grid.el.querySelector('.grid-viewport') };
}

// Scrolling near the bottom adds rows to the sheet. A whole-column selection
// used to stop at the old last row, so Ctrl+- then deleted a hundred rows.
describe('whole-column and whole-row selections when the sheet grows', () => {
  it('keeps a selected column whole after rows are added by scrolling', () => {
    const { wb, id, grid, commands, viewport } = setup();
    try {
      grid.selectByName('B:B');
      const before = wb.sheet(id).rows;
      expect(grid.range).toEqual({ r1: 0, c1: 1, r2: 1048575, c2: 1 });
      viewport.scrollTop = 1e6;
      viewport.dispatchEvent(new Event('scroll'));
      const after = wb.sheet(id).rows;
      expect(after).toBeGreaterThan(before);
      expect(grid.range).toEqual({ r1: 0, c1: 1, r2: 1048575, c2: 1 });
      viewport.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
      expect(commands.at(-1)[0]).toBe('deleteCols');
    } finally { grid.destroy(); }
  });

  it('keeps selected rows whole after columns are added, and grows extra ranges too', () => {
    const { wb, id, grid, viewport } = setup();
    try {
      grid.setRanges([{ r1: 0, c1: 0, r2: 0, c2: wb.sheet(id).cols - 1, scope: 'rows' }, { r1: 4, c1: 0, r2: 4, c2: wb.sheet(id).cols - 1, scope: 'rows' }]);
      const before = wb.sheet(id).cols;
      viewport.scrollLeft = 1e6;
      viewport.dispatchEvent(new Event('scroll'));
      const after = wb.sheet(id).cols;
      expect(after).toBeGreaterThan(before);
      expect(grid.ranges.map((rg) => rg.c2)).toEqual([16383, 16383]);
    } finally { grid.destroy(); }
  });

  it('leaves an ordinary range alone when the sheet grows', () => {
    const { grid, viewport } = setup();
    try {
      grid.selectByName('B2:C5');
      viewport.scrollTop = 1e6;
      viewport.dispatchEvent(new Event('scroll'));
      expect(grid.range).toEqual({ r1: 1, c1: 1, r2: 4, c2: 2 });
    } finally { grid.destroy(); }
  });
});

it('keeps a finite selection at the allocated edge finite when the grid grows', () => {
  const { wb, id, grid, viewport } = setup();
  try {
    const last = wb.sheet(id).rows - 1;
    grid.selectByName(`B1:C${last + 1}`);
    viewport.scrollTop = 1e6; viewport.dispatchEvent(new Event('scroll'));
    expect(wb.sheet(id).rows).toBeGreaterThan(last + 1);
    expect(grid.range.r2).toBe(last);
    expect(grid.formatRanges[0].scope).toBeUndefined();
    expect(wb.activeSheet.viewSelection.ranges[0].r2).toBe(last);
  } finally { grid.destroy(); }
});
it('restores header intent from saved native selections without expanding the grid', () => {
  const { wb, id, grid } = setup();
  grid.selectByName('B:C'); grid.destroy();
  const saved = new Workbook(wb.toJSON()), rows = saved.activeSheet.rows;
  const restored = createGrid({ wb: saved, sheetId: id, announce() {} });
  try {
    expect(restored.formatRanges[0]).toEqual({ r1: 0, c1: 1, r2: rows - 1, c2: 2, scope: 'columns' });
    expect(saved.activeSheet.rows).toBe(rows);
    restored.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(restored.formatRanges[0].scope).toBe('columns');
  } finally { restored.destroy(); }
});
