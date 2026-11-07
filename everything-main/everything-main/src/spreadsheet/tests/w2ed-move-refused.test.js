// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

// Dragging a selection by its border asks the workbook to move it, which
// refuses a block that would split a table or an array, or land a table on
// another one. The grid just redrew the old selection, so nothing said why.
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

async function setup(fill) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  fill(wb, id);
  const invalid = [];
  const announced = [];
  const protectedEvents = [];
  wb.addEventListener('change', (e) => { if (e.detail?.type === 'protected') protectedEvents.push(e.detail); });
  const grid = createGrid({ wb, sheetId: id, announce: (t) => announced.push(t), onInvalid: (v) => invalid.push(v.message) });
  document.body.replaceChildren(grid.el);
  await flush();
  // Columns are 100px and rows 24px in jsdom; the drag starts on the left border of the selection.
  const drag = (address, dx) => {
    grid.selectByName(address);
    const top = grid.range.r1 * 24 + 13;
    const pe = (type, x, y) => grid.viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 12, button: 0, pointerType: 'mouse' }));
    pe('pointerdown', 1, top);
    pe('pointermove', 1 + dx, top);
    pe('pointerup', 1 + dx, top);
  };
  return { wb, id, grid, invalid, announced, protectedEvents, drag };
}

describe('a border drag the workbook refuses', () => {
  it('says a table cannot be split when the block takes part of it along with cells outside', async () => {
    const { wb, id, grid, invalid, announced, drag } = await setup((wb, id) => {
      for (let r = 0; r < 5; r++) { wb.setInput(id, r, 0, `a${r}`); wb.setInput(id, r, 1, `b${r}`); }
      wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
    });
    try {
      drag('A1:A4', 300);
      expect(wb.getValue(id, 0, 3)).toBeNull();
      expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 3, c2: 0 });
      expect(invalid).toEqual(['Table Sales cannot be split: move the whole table, or cells outside it']);
      expect(announced.at(-1)).toBe(invalid[0]);
    } finally { grid.destroy(); }
  });

  it('says a table cannot land on another table', async () => {
    const { wb, id, grid, invalid, drag } = await setup((wb, id) => {
      for (let r = 0; r < 3; r++) { wb.setInput(id, r, 0, `a${r}`); wb.setInput(id, r, 3, `d${r}`); }
      wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Left' });
      wb.addTable(id, { r1: 0, c1: 3, r2: 2, c2: 3 }, { name: 'Right' });
    });
    try {
      drag('A1:A3', 300);
      expect(wb.tableAt(id, 0, 0)?.name).toBe('Left');
      expect(invalid).toEqual(['Table Left cannot be dropped on another table']);
    } finally { grid.destroy(); }
  });

  it('says part of an array cannot leave its formula', async () => {
    const { wb, id, grid, invalid, drag } = await setup((wb, id) => {
      wb.setInput(id, 0, 0, '=SEQUENCE(3)');
      wb.getValue(id, 0, 0);
    });
    try {
      drag('A2:A3', 200);
      expect([wb.getValue(id, 1, 0), wb.getValue(id, 1, 2)]).toEqual([2, null]);
      expect(invalid).toEqual(['Part of an array cannot be moved without its formula in A1']);
    } finally { grid.destroy(); }
  });

  it('leaves a protected cell in the way to the workbook, which reports it', async () => {
    const { grid, invalid, protectedEvents, drag } = await setup((wb, id) => {
      for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, `a${r}`);
      wb.protectRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 'Keep');
    });
    try {
      drag('A1:A3', 200);
      expect(protectedEvents.length).toBe(1);
      expect(invalid).toEqual([]);
    } finally { grid.destroy(); }
  });

  it('moves a block the workbook allows without comment', async () => {
    const { wb, id, grid, invalid, announced, drag } = await setup((wb, id) => {
      for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, `a${r}`);
    });
    try {
      drag('A1:A3', 200);
      expect(wb.getValue(id, 0, 2)).toBe('a0');
      expect(invalid).toEqual([]);
      expect(announced.at(-1)).toBe('Moved to C1:C3');
    } finally { grid.destroy(); }
  });
});
