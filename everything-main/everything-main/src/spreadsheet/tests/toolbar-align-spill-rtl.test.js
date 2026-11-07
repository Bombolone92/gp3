// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => document.body.replaceChildren());

// The toolbar read the active cell's value only when the cell had an object of its own, so a cell a
// formula spilled into (which has none) counted as empty and "Align left" was pressed on a number the grid
// drew at the right; pressing that pressed button then wrote a left alignment and visibly moved the number.
// Text that reads right to left sits at the right too, and read as "Align left" as well.
function pressedOn(wb, r, c, style = {}) {
  const id = wb.activeSheetId;
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => wb.getCell(id, r, c), style: () => style, active: () => ({ r, c }),
    range: () => ({ r1: r, c1: c, r2: r, c2: c }), sheetId: () => id, grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  toolbar.refresh();
  const pressed = ['Align left', 'Align center', 'Align right'].filter((label) => toolbar.el.querySelector(`[aria-label="${label}"]`).getAttribute('aria-pressed') === 'true');
  toolbar.el.remove();
  return pressed;
}

describe('the alignment buttons on a cell with no alignment of its own', () => {
  it('press Align right on a spilled number, as on the number at the anchor', () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '={10;20;30}');
    expect(wb.getCell(wb.activeSheetId, 1, 0)).toBeFalsy(); // a spill target has no cell of its own
    expect(pressedOn(wb, 0, 0)).toEqual(['Align right']);
    expect(pressedOn(wb, 1, 0)).toEqual(['Align right']);
    expect(pressedOn(wb, 2, 0)).toEqual(['Align right']);
  });

  it('press Align center on a spilled boolean, as the grid centres it', () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '={TRUE;FALSE}');
    expect(pressedOn(wb, 1, 0)).toEqual(['Align center']);
  });

  it('press Align right on text that reads right to left, and Align left on other text and on an empty cell', () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, 'שלום עולם');
    wb.setInput(wb.activeSheetId, 1, 0, 'مرحبا');
    wb.setInput(wb.activeSheetId, 2, 0, 'hello');
    expect(pressedOn(wb, 0, 0)).toEqual(['Align right']);
    expect(pressedOn(wb, 1, 0)).toEqual(['Align right']);
    expect(pressedOn(wb, 2, 0)).toEqual(['Align left']);
    expect(pressedOn(wb, 3, 0)).toEqual(['Align left']);
  });

  it('still press the alignment the style sets', () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '={10;20}');
    wb.setInput(wb.activeSheetId, 0, 1, 'שלום');
    expect(pressedOn(wb, 1, 0, { align: 'left' })).toEqual(['Align left']);
    expect(pressedOn(wb, 0, 1, { align: 'center' })).toEqual(['Align center']);
  });
});
