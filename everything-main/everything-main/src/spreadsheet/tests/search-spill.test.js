import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { findAll, findAllSheets, replaceCells } from '../src/core/search.js';

describe('finding spilled formula results', () => {
  it('finds displayed array values in reading order, including formatted empty cells', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=SEQUENCE(3,2)');
    wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bold: true });
    expect(findAll(wb, id, '^[1-6]$', { regex: true, formulas: false })).toEqual([
      { r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 0 },
      { r: 1, c: 1 }, { r: 2, c: 0 }, { r: 2, c: 1 },
    ]);
    expect(findAll(wb, id, 'SEQUENCE')).toEqual([{ r: 0, c: 0 }]);
    expect(findAll(wb, id, '6', { range: { r1: 0, c1: 0, r2: 1, c2: 1 } })).toEqual([]);
  });

  it('uses the spill number format and any format applied to an individual result', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=SEQUENCE(3,1,0.1,0.1)');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'percent', dec: 0 });
    wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { fmt: 'number', dec: 2 });
    expect(findAll(wb, id, '20%', { wholeCell: true })).toEqual([{ r: 1, c: 0 }]);
    expect(findAll(wb, id, '0.30', { wholeCell: true })).toEqual([{ r: 2, c: 0 }]);
  });

  it('refreshes spill matches after edits and includes them across sheets', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=SEQUENCE(3)');
    const other = wb.addSheet('Other');
    wb.setInput(other.id, 0, 0, '=SEQUENCE(3)');
    expect(findAllSheets(wb, '3', { formulas: false }, id)).toHaveLength(2);
    wb.setInput(id, 0, 0, '=SEQUENCE(2)');
    expect(findAllSheets(wb, '3', { formulas: false }, id)).toEqual([{ sheetId: other.id, r: 2, c: 0 }]);
  });

  it('does not overwrite calculated spill results during replacement', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=SEQUENCE(3)');
    wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bold: true });
    const matches = findAll(wb, id, '3', { formulas: false });
    expect(matches).toEqual([{ r: 2, c: 0 }]);
    expect(replaceCells(wb, id, matches, '3', '9', { formulas: false })).toBe(0);
    expect(wb.getValue(id, 2, 0)).toBe(3);
    expect(wb.getValue(id, 0, 0)).toBe(1);
  });
});
