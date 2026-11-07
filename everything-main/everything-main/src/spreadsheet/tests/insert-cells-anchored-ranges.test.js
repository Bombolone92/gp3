import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

/**
 * A validation, conditional format or protected range applied to a whole column ends at the file
 * grid's last row, where it stays anchored. Insert cells must not read that as content the shift
 * would push off the sheet, or it is refused for ever on that sheet.
 */
describe('insert cells beside a range anchored at the sheet edge', () => {
  it('shifts cells down under a whole-column validation', () => {
    const wb = new Workbook({ sheets: [{ name: 'Main', cells: { '0,1': { v: 1, f: null } },
      validations: [{ id: 'v1', type: 'number', range: { r1: 0, c1: 1, r2: MAX_ROW, c2: 1 }, op: 'gt', value: 0 }] }] });
    const id = wb.sheets[0].id;
    expect(wb.insertCells(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, 'down')).toBe(true);
    expect(wb.getValue(id, 1, 1)).toBe(1);
    expect(wb.sheet(id).validations[0].range.r2).toBe(MAX_ROW);
    wb.undo();
    expect(wb.getValue(id, 0, 1)).toBe(1);
    expect(wb.sheet(id).validations[0].range).toEqual({ r1: 0, c1: 1, r2: MAX_ROW, c2: 1 });
  });

  it('shifts cells down under a whole-column conditional format', () => {
    const wb = new Workbook({ sheets: [{ name: 'Main', cells: { '0,2': { v: 5, f: null } },
      rules: [{ id: 'r1', type: 'gt', value: '1', range: { r1: 0, c1: 2, r2: MAX_ROW, c2: 2 }, style: { bold: true } }] }] });
    const id = wb.sheets[0].id;
    expect(wb.insertCells(id, { r1: 0, c1: 2, r2: 0, c2: 2 }, 'down')).toBe(true);
    expect(wb.getValue(id, 1, 2)).toBe(5);
    expect(wb.sheet(id).rules.at(-1).range.r2).toBe(MAX_ROW);
  });

  it('shifts cells down beside a whole-column protected range', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.protectRange(id, { r1: 0, c1: 5, r2: MAX_ROW, c2: 5 });
    wb.setInput(id, 0, 6, 'keep');
    expect(wb.insertCells(id, { r1: 0, c1: 6, r2: 0, c2: 6 }, 'down')).toBe(true);
    expect(wb.getValue(id, 1, 6)).toBe('keep');
    expect(wb.sheet(id).protectedRanges[0].range).toEqual({ r1: 0, c1: 5, r2: MAX_ROW, c2: 5 });
  });

  it('shifts cells right beside a whole-row rule', () => {
    const wb = new Workbook({ sheets: [{ name: 'Main', cells: { '3,0': { v: 2, f: null } },
      rules: [{ id: 'r1', type: 'gt', value: '1', range: { r1: 3, c1: 0, r2: 3, c2: MAX_COL }, style: { bold: true } }] }] });
    const id = wb.sheets[0].id;
    expect(wb.insertCells(id, { r1: 3, c1: 0, r2: 3, c2: 0 }, 'right')).toBe(true);
    expect(wb.getValue(id, 3, 1)).toBe(2);
    expect(wb.sheet(id).rules.at(-1).range.c2).toBe(MAX_COL);
  });

  it('keeps a merge that reaches the last row anchored there', () => {
    const wb = new Workbook({ sheets: [{ name: 'Main', rows: MAX_ROW + 1,
      merges: [{ r1: MAX_ROW - 2, c1: 1, r2: MAX_ROW, c2: 1 }] }] });
    const id = wb.sheets[0].id;
    expect(wb.insertCells(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, 'down')).toBe(true);
    expect(wb.sheet(id).merges[0]).toEqual({ r1: MAX_ROW - 1, c1: 1, r2: MAX_ROW, c2: 1 });
  });

  it('still refuses a shift that would push a stored cell off the sheet', () => {
    const wb = new Workbook({ sheets: [{ name: 'Main', rows: MAX_ROW + 1, cells: { [`${MAX_ROW},1`]: { v: 9, f: null } } }] });
    const id = wb.sheets[0].id;
    expect(wb.insertCells(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, 'down')).toBe(false);
    expect(wb.getValue(id, MAX_ROW, 1)).toBe(9);
  });
});
