import { describe, expect, it } from 'vitest';
import { Workbook, DEFAULT_ROWS } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { MAX_ROW } from '../src/core/refs.js';

describe('deleting every row of a sheet', () => {
  it('takes the merges, rules, validations, groups, and filter on the last row with it', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 99, 0, 'x');
    wb.setInput(id, 89, 0, 'Head');
    wb.mergeCells(id, parseRange('A100:B100'));
    wb.addRule(id, { type: 'gt', range: parseRange('A100:A100'), value: 1, style: { bold: true } });
    wb.addRule(id, { type: 'gt', range: parseRange('A90:A100'), value: 1, style: { italic: true } });
    wb.addValidation(id, { type: 'list', range: parseRange('A100:A100'), source: ['a'], strict: false });
    wb.groupLines(id, 'row', 97, 99);
    wb.setFilterRange(id, parseRange('A90:A100'));
    const before = wb.toJSON();
    wb.clearHistory();
    wb.deleteRows(id, 0, DEFAULT_ROWS);
    const sheet = wb.sheet(id);
    expect(sheet.cells.size).toBe(0);
    expect(sheet.merges).toEqual([]);
    expect(sheet.rules).toEqual([]);
    expect(sheet.validations).toEqual([]);
    expect(sheet.filter).toBeNull();
    expect(wb.outlineGroups(id, 'row')).toEqual([]);
    expect(sheet.rows).toBe(DEFAULT_ROWS);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
  });

  it('keeps a rule over a whole column ($A:$A) whole, since its column is still there', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.addRule(id, { type: 'gt', range: { r1: 0, c1: 0, r2: MAX_ROW, c2: 0 }, value: 1, style: { bold: true } });
    wb.deleteRows(id, 0, DEFAULT_ROWS);
    expect(wb.sheet(id).rules).toHaveLength(1);
    expect(wb.sheet(id).rules[0].range).toEqual({ r1: 0, c1: 0, r2: MAX_ROW, c2: 0 }); // the grid refills its last rows
  });

  it('does the same for columns', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const last = wb.sheet(id).cols - 1;
    wb.setInput(id, 0, last, 'x');
    wb.mergeCells(id, { r1: 0, c1: last, r2: 1, c2: last });
    wb.addRule(id, { type: 'gt', range: { r1: 0, c1: last, r2: 5, c2: last }, value: 1, style: { bold: true } });
    wb.groupLines(id, 'col', last - 1, last);
    wb.deleteCols(id, 0, wb.sheet(id).cols);
    expect(wb.sheet(id).merges).toEqual([]);
    expect(wb.sheet(id).rules).toEqual([]);
    expect(wb.outlineGroups(id, 'col')).toEqual([]);
  });
});
