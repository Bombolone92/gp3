import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const range = (r1, c1, r2, c2) => ({ r1, c1, r2, c2 });
const styleOnly = (s) => ({ v: null, f: null, s });

// Inserted rows and columns arrived with no formatting, so a row added inside a currency table
// showed plain numbers. New rows take the formatting of the row above (new columns, of the column
// to the left); only the formatting comes along, never values or formulas.
describe('inserting rows', () => {
  it('gives the new rows the formatting of the row above, and nothing else', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const s = { bold: true, bg: '#ffff00', fmt: 'currency', cur: 'USD' };
    wb.applyStyle(id, range(0, 0, 2, 2), s);
    wb.setInput(id, 0, 0, '10');
    wb.setInput(id, 0, 1, '=A1*2');
    wb.setInput(id, 0, 3, 'plain'); // a value with no formatting beside the styled block
    wb.setNote(id, 0, 0, 'a note');
    expect(wb.insertRows(id, 1, 2)).toBe(true);
    for (const r of [1, 2]) {
      expect([0, 1, 2].map((c) => wb.getCell(id, r, c))).toEqual([styleOnly(s), styleOnly(s), styleOnly(s)]);
      expect(wb.getCell(id, r, 3)).toBeUndefined();
      expect(wb.getNote(id, r, 0)).toBeNull();
    }
    // The moved rows keep their own cells; the formula still reads A1.
    expect(wb.getCell(id, 3, 0)).toEqual(styleOnly(s));
    expect(wb.getValue(id, 0, 1)).toBe(20);
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 10, f: null, s });
    // Typing into a new row shows through the inherited format.
    wb.setInput(id, 1, 0, '5');
    expect(wb.getDisplay(id, 1, 0)).toBe('$5.00');
  });

  it('inherits nothing at the first row, and undo and redo restore the sheet exactly', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, range(0, 0, 0, 1), { italic: true });
    wb.insertRows(id, 0, 1);
    expect(wb.getCell(id, 0, 0)).toBeUndefined();
    expect(wb.getCell(id, 1, 0)).toEqual(styleOnly({ italic: true }));
    const before = JSON.stringify(wb.toJSON().sheets[0].cells);
    wb.insertRows(id, 2, 1);
    expect(wb.getCell(id, 2, 1)).toEqual(styleOnly({ italic: true }));
    wb.undo();
    expect(JSON.stringify(wb.toJSON().sheets[0].cells)).toBe(before);
    wb.redo();
    expect(wb.getCell(id, 2, 1)).toEqual(styleOnly({ italic: true }));
  });

  it('does not copy a table header\'s formatting into the first data row, nor a merged cell\'s', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [
      { r: 0, c: 0, cell: { v: 'Item', s: { bold: true, color: '#ff0000' } } },
      { r: 0, c: 1, cell: { v: 'Qty', s: { bold: true, color: '#ff0000' } } },
      { r: 1, c: 0, cell: { v: 'a', s: { italic: true } } },
      { r: 1, c: 1, cell: { v: 1, s: { fmt: 'number', dec: 1 } } },
      { r: 2, c: 0, cell: { v: 'b' } },
      { r: 2, c: 1, cell: { v: 2 } },
      { r: 0, c: 3, cell: { v: 'beside', s: { underline: true } } },
    ], 'seed');
    wb.addTable(id, range(0, 0, 2, 1), { name: 'Stock' });
    // Below the header: the header's look is the table's, not the new row's.
    wb.insertRows(id, 1, 1);
    expect(wb.getCell(id, 1, 0)).toBeUndefined();
    expect(wb.getCell(id, 1, 1)).toBeUndefined();
    // A cell in the header row but outside the table still passes its formatting down.
    expect(wb.getCell(id, 1, 3)).toEqual(styleOnly({ underline: true }));
    // Below a data row: its formatting comes along.
    wb.insertRows(id, 3, 1);
    expect(wb.getCell(id, 3, 0)).toEqual(styleOnly({ italic: true }));
    expect(wb.getCell(id, 3, 1)).toEqual(styleOnly({ fmt: 'number', dec: 1 }));
    // A merged block: its cells lend nothing to the row inserted under it, though cells beside it do.
    wb.applyStyle(id, range(6, 0, 7, 2), { bg: '#00ff00' });
    wb.mergeCells(id, range(6, 0, 7, 1));
    wb.insertRows(id, 8, 1);
    expect(wb.getCell(id, 8, 0)).toBeUndefined();
    expect(wb.getCell(id, 8, 1)).toBeUndefined();
    expect(wb.getCell(id, 8, 2)).toEqual(styleOnly({ bg: '#00ff00' }));
    // Inside the merge, the block just grows.
    wb.insertRows(id, 7, 1);
    expect(wb.mergeAt(id, 7, 0)).toEqual(range(6, 0, 8, 1));
    expect(wb.getCell(id, 7, 0)).toBeUndefined();
  });
});

describe('inserting columns', () => {
  it('gives the new columns the formatting of the column to their left, and nothing at the first column', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const s = { align: 'center', fmt: 'percent', dec: 0 };
    wb.applyStyle(id, range(0, 0, 2, 0), s);
    wb.setInput(id, 0, 0, '50%');
    wb.setInput(id, 3, 0, 'unstyled');
    expect(wb.insertCols(id, 1, 2)).toBe(true);
    for (const c of [1, 2]) {
      expect([0, 1, 2].map((r) => wb.getCell(id, r, c))).toEqual([styleOnly(s), styleOnly(s), styleOnly(s)]);
      expect(wb.getCell(id, 3, c)).toBeUndefined();
    }
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 0.5, f: null, s });
    expect(wb.getCell(id, 3, 3)).toBeUndefined();
    wb.insertCols(id, 0, 1);
    expect([0, 1, 2].map((r) => wb.getCell(id, r, 0))).toEqual([undefined, undefined, undefined]);
    expect(wb.getCell(id, 0, 1)).toEqual({ v: 0.5, f: null, s });
  });

  it('keeps the inherited formatting on the header cell a table names for a new column', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const head = { bold: true, bg: '#eeeeee' };
    wb.setCells(id, [
      { r: 0, c: 0, cell: { v: 'Item', s: head } }, { r: 0, c: 1, cell: { v: 'Qty', s: head } },
      { r: 1, c: 0, cell: { v: 'a' } }, { r: 1, c: 1, cell: { v: 1 } },
    ], 'seed');
    wb.addTable(id, range(0, 0, 1, 1), { name: 'Stock' });
    wb.insertCols(id, 1, 1);
    const header = wb.getCell(id, 0, 1);
    expect(header.s).toEqual(head);
    expect(typeof header.v).toBe('string');
    expect(header.v).not.toBe('');
    expect(wb.tableColumns(id, wb.sheet(id).tables[0])).toEqual(['Item', header.v, 'Qty']);
  });
});
