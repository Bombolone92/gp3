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
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const pointer = (target, type, x, y) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse' }));
const dblclick = (target) => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));

function setup(cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [k, text] of Object.entries(cells)) { const [r, c] = k.split(',').map(Number); wb.setInput(id, r, c, text); }
  wb.clearHistory();
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid };
}

describe('several selected columns or rows', () => {
  it('are resized together as one undo step', async () => {
    const { wb, id, grid } = setup();
    await flush();
    grid.selectByName('A:C');
    const colClip = grid.el.querySelector('.grid-colhead-clip');
    pointer(colClip.querySelector('.col-resizer[data-c="1"]'), 'pointerdown', 200, 10);
    pointer(colClip, 'pointermove', 230, 10);
    pointer(colClip, 'pointerup', 230, 10);
    expect([0, 1, 2].map((c) => wb.colWidth(id, c))).toEqual([130, 130, 130]);
    expect(wb.undoLabel()).toBe('Resize columns');
    wb.undo();
    expect([0, 1, 2].map((c) => wb.colWidth(id, c))).toEqual([100, 100, 100]);
    expect(wb.canUndo()).toBe(false);

    grid.selectByName('2:3');
    const rowClip = grid.el.querySelector('.grid-rowhead-clip');
    pointer(rowClip.querySelector('.row-resizer[data-r="1"]'), 'pointerdown', 20, 52);
    pointer(rowClip, 'pointermove', 20, 72);
    pointer(rowClip, 'pointerup', 20, 72);
    expect([1, 2].map((r) => wb.rowHeight(id, r))).toEqual([Math.round(DEFAULT_ROW_HEIGHT) + 20, Math.round(DEFAULT_ROW_HEIGHT) + 20]);
    expect(wb.undoLabel()).toBe('Resize rows');
    wb.undo();
    expect([1, 2].map((r) => wb.rowHeight(id, r))).toEqual([DEFAULT_ROW_HEIGHT, DEFAULT_ROW_HEIGHT]);
    grid.destroy();
  });

  it('are all fitted to their contents by a double-click on one of their edges', async () => {
    const { wb, id, grid } = setup({ '0,0': 'x'.repeat(30), '0,1': 'y'.repeat(20), '0,2': 'z'.repeat(40) });
    await flush();
    grid.selectByName('A:B');
    dblclick(grid.el.querySelector('.col-resizer[data-c="0"]'));
    expect(wb.colWidth(id, 0)).toBe(30 * 7 + 14);
    expect(wb.colWidth(id, 1)).toBe(20 * 7 + 14);
    expect(wb.colWidth(id, 2)).toBe(100); // not selected, left alone
    wb.undo();
    expect([wb.colWidth(id, 0), wb.colWidth(id, 1)]).toEqual([100, 100]);
    expect(wb.canUndo()).toBe(false);
    // A column outside the selection still fits on its own.
    dblclick(grid.el.querySelector('.col-resizer[data-c="2"]'));
    expect(wb.colWidth(id, 2)).toBe(40 * 7 + 14);
    expect([wb.colWidth(id, 0), wb.colWidth(id, 1)]).toEqual([100, 100]);

    wb.setRowHeight(id, 1, 100);
    wb.setRowHeight(id, 2, 100);
    wb.clearHistory();
    await flush();
    grid.selectByName('2:3');
    dblclick(grid.el.querySelector('.row-resizer[data-r="1"]'));
    expect([1, 2].map((r) => wb.rowHeight(id, r))).toEqual([DEFAULT_ROW_HEIGHT, DEFAULT_ROW_HEIGHT]); // empty rows fit back to the default
    wb.undo();
    expect([1, 2].map((r) => wb.rowHeight(id, r))).toEqual([100, 100]);
    expect(wb.canUndo()).toBe(false);
    grid.destroy();
  });
});
