import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function sheetOf(rows, cols, dataRows, dataCols) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, rows, cols);
  const entries = [];
  for (let r = 0; r < dataRows; r++) for (let c = 0; c < dataCols; c++) entries.push({ r, c, cell: { v: r * dataCols + c, f: null } });
  if (entries.length) wb.setCells(id, entries, 'fill');
  wb.clearHistory();
  return { wb, id, sheet: wb.sheet(id), whole: { r1: 0, c1: 0, r2: wb.sheet(id).rows - 1, c2: wb.sheet(id).cols - 1 } };
}

/** How often JSON.stringify runs while `fn` does. */
function stringifiesDuring(fn) {
  const orig = JSON.stringify;
  let n = 0;
  JSON.stringify = function (...args) { n++; return orig.apply(this, args); };
  try { fn(); } finally { JSON.stringify = orig; }
  return n;
}

// Select all → Bold on a 20,000-row sheet stored a style-only cell for every empty coordinate: 200,000 cells
// became 520,000, the action took most of a second, and every later save, scan and draft carried them.
describe('formatting a whole large sheet', () => {
  it('formats the cells holding values without storing one per empty coordinate, and compares no cell as text', { timeout: 60000 }, () => {
    const { wb, id, sheet, whole } = sheetOf(20000, 26, 20000, 10);
    expect(sheet.cells.size).toBe(200000);
    const stringified = stringifiesDuring(() => wb.applyStyle(id, whole, { bold: true }));
    expect(sheet.cells.size).toBe(200000);
    expect(stringified).toBe(0);
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true });
    expect(wb.getCell(id, 19999, 9).s).toEqual({ bold: true });
    expect(wb.getCell(id, 5, 20)).toBeUndefined(); // an empty column stays empty
    expect(wb.undoLabel()).toBe('Format');
    // The active cell decides a toggle, as before: bold on it, so the toggle takes bold away everywhere.
    wb.toggleStyle(id, whole, 'bold', { r: 3, c: 3 });
    expect(wb.getCell(id, 19999, 9).s).toBeUndefined();
    expect(sheet.cells.size).toBe(200000);
    wb.undo();
    expect(wb.getCell(id, 19999, 9).s).toEqual({ bold: true });
    wb.undo();
    expect(wb.getCell(id, 0, 0).s).toBeUndefined();
    expect(sheet.cells.size).toBe(200000);
  });

  it('reaches the empty cells within a fresh sheet\'s size beyond the data, so what is typed next to it takes the format', () => {
    const { wb, id, sheet, whole } = sheetOf(20000, 26, 200, 5);
    wb.applyStyle(id, whole, { bg: '#ffff00' });
    // 200 rows of data, 100 more below them, across every column: 300 × 26 cells, of which 1,000 held values.
    expect(sheet.cells.size).toBe(300 * 26);
    expect(wb.getCell(id, 199, 4).s).toEqual({ bg: '#ffff00' });
    expect(wb.getCell(id, 250, 20).s).toEqual({ bg: '#ffff00' });
    expect(wb.getCell(id, 0, 25).s).toEqual({ bg: '#ffff00' });
    expect(wb.getCell(id, 300, 0)).toBeUndefined();
    expect(wb.getCell(id, 19999, 25)).toBeUndefined();
  });

  it('formats a fresh sheet\'s worth of an empty large sheet, from the range\'s corner', () => {
    const { wb, id, sheet, whole } = sheetOf(20000, 26, 0, 0);
    wb.applyStyle(id, whole, { italic: true });
    expect(sheet.cells.size).toBe(100 * 26);
    expect(wb.getCell(id, 0, 0).s).toEqual({ italic: true });
    expect(wb.getCell(id, 99, 25).s).toEqual({ italic: true });
    expect(wb.getCell(id, 100, 0)).toBeUndefined();
  });

  it('leaves the empty cells alone when the data itself spreads past the cap, and skips the rows a filter hides', () => {
    const { wb, id, sheet, whole } = sheetOf(2000, 26, 2000, 10); // 52,000 cells selected, the block of data 2,000 × 26
    wb.applyStyle(id, whole, { bold: true }, { skipRow: (r) => r % 2 === 1 });
    expect(sheet.cells.size).toBe(20000);
    expect(wb.getCell(id, 0, 9).s).toEqual({ bold: true });
    expect(wb.getCell(id, 1, 9).s).toBeUndefined();
    expect(wb.getCell(id, 1998, 0).s).toEqual({ bold: true });
    expect(wb.getCell(id, 0, 10)).toBeUndefined();
  });

  it('still formats every empty cell of a selection within the cap', () => {
    const { wb, id, sheet } = sheetOf(100, 26, 3, 3);
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 9, c2: 9 }, { bold: true });
    expect(sheet.cells.size).toBe(100);
    expect(wb.getCell(id, 9, 9).s).toEqual({ bold: true });
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 99, c2: 25 }, { italic: true }); // the whole sheet, 2,600 cells
    expect(sheet.cells.size).toBe(2600);
    expect(wb.getCell(id, 99, 25).s).toEqual({ italic: true });
  });
});

describe('the comparison an edit makes for each cell it writes', () => {
  it('takes a cell written as it already is for no change, whatever the order of its style keys', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, f: null, s: { bold: true, italic: true, dec: 2 } } }], 'Edit');
    expect(wb._history).toHaveLength(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, f: null, s: { dec: 2, italic: true, bold: true } } }], 'Edit')).toBe(0);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, f: null, s: { dec: 2, italic: true, bold: true, fmt: undefined } } }], 'Edit')).toBe(0);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, s: { dec: 2, italic: true, bold: true } } }], 'Edit')).toBe(0);
    expect(wb._history).toHaveLength(1);
    // And any difference, in a value, a formula or a style, for a change.
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, f: null, s: { dec: 3, italic: true, bold: true } } }], 'Edit')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 1, f: null, s: { italic: true, bold: true } } }], 'Edit')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: '1', f: null, s: { italic: true, bold: true } } }], 'Edit')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: '=1', s: { italic: true, bold: true } } }], 'Edit')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: '=1' } }], 'Edit')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: null }], 'Edit')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: null }], 'Edit')).toBe(0);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: null, s: {} } }], 'Edit')).toBe(0);
  });

  it('compares an error value pasted as a value by its code', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: { error: '#N/A' }, f: null } }], 'Paste')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: { error: '#N/A' }, f: null } }], 'Paste')).toBe(0);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: { error: '#DIV/0!' }, f: null } }], 'Paste')).toBe(1);
    expect(wb.setCells(id, [{ r: 0, c: 0, cell: { v: 5, f: null } }], 'Paste')).toBe(1);
  });
});
