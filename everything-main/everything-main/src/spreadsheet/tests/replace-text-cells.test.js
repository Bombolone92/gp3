import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { findAll, replaceCells } from '../src/core/search.js';

// Replace rewrote a text cell's new wording as a fresh entry, so "00501" lost its zeros as the
// number 509, and text that looked like a formula started calculating.
describe('replacing inside a text cell', () => {
  it('keeps text that reads as a number or a formula as text, as retyping it in the editor would', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 1, 0, "'=1+1");
    wb.setCells(id, [
      { r: 5, c: 0, cell: { v: '00501', f: null } }, // imported: text without the Plain text format
      { r: 6, c: 0, cell: { v: '=SUM(1)', f: null } },
      { r: 7, c: 0, cell: { v: 'Rent1', f: null } },
      { r: 8, c: 0, cell: { v: '1 May', f: null } },
    ], 'seed');
    expect(replaceCells(wb, id, findAll(wb, id, '1'), '1', '9')).toBe(5);
    expect(wb.getCell(id, 1, 0)).toMatchObject({ v: '=9+9', f: null });
    expect(wb.getCell(id, 5, 0)).toMatchObject({ v: '00509', f: null });
    expect(wb.getCell(id, 6, 0)).toMatchObject({ v: '=SUM(9)', f: null });
    expect(wb.getCell(id, 8, 0)).toMatchObject({ v: '9 May', f: null });
    expect(wb.getValue(id, 7, 0)).toBe('Rent9');
    wb.undo();
    expect(wb.getValue(id, 5, 0)).toBe('00501');
  });

  it('still lets a label be replaced by a number or a formula', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Rent');
    wb.setInput(id, 1, 0, 'Total');
    expect(replaceCells(wb, id, [{ r: 0, c: 0 }], 'Rent', '1500')).toBe(1);
    expect(wb.getValue(id, 0, 0)).toBe(1500);
    expect(replaceCells(wb, id, [{ r: 1, c: 0 }], 'Total', '=SUM(A1)')).toBe(1);
    expect(wb.getCell(id, 1, 0).f).toBe('SUM(A1)');
  });
});
