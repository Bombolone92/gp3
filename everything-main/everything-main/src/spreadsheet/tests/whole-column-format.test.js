import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/**
 * A format applied to a whole column used to be materialised as one stored cell per row the sheet
 * happened to have, so it was lost for every row reached later and a sheet scrolled to row 20,000
 * carried 20,000 blank cells into every save. The format now lives on the column itself; `styleAt`
 * reads a cell's own style over its row's and column's defaults.
 */
const wholeCol = (wb, id, c) => ({ r1: 0, c1: c, r2: wb.sheet(id).rows - 1, c2: c });

describe('a format on a whole column', () => {
  it('holds for rows the sheet reaches later', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 1), { fmt: 'currency', cur: 'USD' });
    wb.ensureSize(id, 300, 26);
    expect(wb.styleAt(id, 250, 1)).toMatchObject({ fmt: 'currency', cur: 'USD' });
    wb.setInput(id, 250, 1, '5');
    expect(wb.getDisplay(id, 250, 1)).toBe('$5.00');
    expect(wb.getCell(id, 250, 1).s).toMatchObject({ fmt: 'currency', cur: 'USD' });
  });

  it('reaches a value pasted, filled or split into a row past the old extent', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 2), { bg: '#ffff00' });
    wb.ensureSize(id, 400, 26);
    wb.pasteValues(id, [['7']], 300, 2);
    expect(wb.getCell(id, 300, 2).s).toMatchObject({ bg: '#ffff00' });
    wb.fillInput(id, { r1: 310, c1: 2, r2: 311, c2: 2 }, 'z', { r: 310, c: 2 });
    expect(wb.getCell(id, 311, 2).s).toMatchObject({ bg: '#ffff00' });
  });

  it('stores no blank cell per row of a sheet scrolled to the bottom', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 1, 'head');
    wb.ensureSize(id, 20000, 26);
    wb.applyStyle(id, wholeCol(wb, id, 1), { bold: true });
    expect(wb.sheet(id).cells.size).toBeLessThan(200);
    expect(wb.styleAt(id, 19999, 1)).toEqual({ bold: true });
    expect(wb.getCell(id, 0, 1).s).toMatchObject({ bold: true });
  });

  it('still formats every empty cell of a fresh sheet\'s column, as before', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 1), { bg: '#ffff00' });
    expect(wb.getCell(id, 99, 1).s).toEqual({ bg: '#ffff00' });
  });

  it('is undone and redone in one step, line and cells together', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 1), { bold: true });
    expect(wb.sheet(id).colStyles.get(1)).toEqual({ bold: true });
    wb.undo();
    expect(wb.sheet(id).colStyles.size).toBe(0);
    expect(wb.getCell(id, 5, 1)).toBeUndefined();
    wb.redo();
    expect(wb.sheet(id).colStyles.get(1)).toEqual({ bold: true });
    expect(wb.getCell(id, 5, 1).s).toEqual({ bold: true });
  });

  it('survives a reload and an undo of a later structural step', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 1), { italic: true });
    const again = new Workbook(wb.toJSON());
    expect(again.sheet(again.sheets[0].id).colStyles.get(1)).toEqual({ italic: true });
    wb.insertRows(id, 0, 2);
    wb.undo();
    expect(wb.sheet(id).colStyles.get(1)).toEqual({ italic: true });
  });

  it('follows its column through an insertion, a deletion and a move', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 2), { bold: true });
    wb.insertCols(id, 0, 1);
    expect(wb.sheet(id).colStyles.get(3)).toEqual({ bold: true });
    wb.deleteCols(id, 0, 1);
    expect(wb.sheet(id).colStyles.get(2)).toEqual({ bold: true });
    wb.moveCols(id, 2, 1, 0);
    expect(wb.sheet(id).colStyles.get(0)).toEqual({ bold: true });
  });

  it('is taken away by Clear formats over the column', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.applyStyle(id, wholeCol(wb, id, 1), { bold: true });
    wb.clearRange(id, wholeCol(wb, id, 1), { contents: false, styles: true });
    expect(wb.sheet(id).colStyles.size).toBe(0);
    wb.ensureSize(id, 300, 26);
    wb.setInput(id, 250, 1, 'x');
    expect(wb.getCell(id, 250, 1).s).toBeUndefined();
  });

  it('is cleared by Bold pressed again with the cursor on a row the sheet had not stored', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.ensureSize(id, 20000, 26);
    wb.applyStyle(id, wholeCol(wb, id, 1), { bold: true });
    expect(wb.styleAt(id, 19000, 1)).toEqual({ bold: true });
    wb.toggleStyle(id, wholeCol(wb, id, 1), 'bold', { r: 19000, c: 1 });
    expect(wb.styleAt(id, 19000, 1)).toBeUndefined();
    expect(wb.sheet(id).colStyles.size).toBe(0);
  });

  it('is refused on a protected sheet, as it is now', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setSheetProtected(id, true);
    const events = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') events.push(e.detail); });
    wb.applyStyle(id, wholeCol(wb, id, 1), { bold: true });
    expect(wb.sheet(id).colStyles.size).toBe(0);
    expect(events.length).toBeGreaterThan(0);
  });

  it('is refused where a protected range crosses the column', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.protectRange(id, { r1: 3, c1: 1, r2: 4, c2: 1 });
    wb.applyStyle(id, wholeCol(wb, id, 1), { bold: true });
    expect(wb.sheet(id).colStyles.size).toBe(0);
    expect(wb.getCell(id, 0, 1)).toBeUndefined();
  });
});

describe('a format on a whole row', () => {
  it('holds for columns the sheet reaches later, under the cell\'s own style', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    wb.applyStyle(id, { r1: 3, c1: 0, r2: 4, c2: sheet.cols - 1 }, { bold: true });
    expect(sheet.rowStyles.get(3)).toEqual({ bold: true });
    wb.ensureSize(id, 100, 60);
    expect(wb.styleAt(id, 3, 55)).toEqual({ bold: true });
    wb.setInput(id, 3, 55, 'x');
    expect(wb.getCell(id, 3, 55).s).toEqual({ bold: true });
  });

  it('follows its row through an insertion and a deletion', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    wb.applyStyle(id, { r1: 3, c1: 0, r2: 4, c2: sheet.cols - 1 }, { bold: true });
    wb.insertRows(id, 0, 2);
    expect(wb.sheet(id).rowStyles.get(5)).toEqual({ bold: true });
    wb.deleteRows(id, 0, 2);
    expect(wb.sheet(id).rowStyles.get(3)).toEqual({ bold: true });
  });
});

describe('styleAt', () => {
  it('reads the cell over the row over the column, and undefined for nothing', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const sheet = wb.sheet(id);
    expect(wb.styleAt(id, 0, 0)).toBeUndefined();
    sheet.colStyles.set(1, { bold: true, bg: '#eeeeee' });
    sheet.rowStyles.set(2, { bg: '#ffff00', italic: true });
    expect(wb.styleAt(id, 2, 1)).toEqual({ bold: true, bg: '#ffff00', italic: true });
    wb.setCells(id, [{ r: 2, c: 1, cell: { v: 1, f: null, s: { bg: '#00ff00' } } }]);
    expect(wb.styleAt(id, 2, 1)).toEqual({ bold: true, bg: '#00ff00', italic: true });
    expect(wb.getCell(id, 2, 1).s).toEqual({ bg: '#00ff00' });
    expect(wb.styleAt('nosuch', 0, 0)).toBeUndefined();
  });
});
