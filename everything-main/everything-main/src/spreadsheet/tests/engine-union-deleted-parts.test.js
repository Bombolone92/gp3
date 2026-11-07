import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { Workbook } from '../src/core/workbook.js';

// Deleting the rows a union named turns =SUM((A2,A5)) into =SUM((#REF!,#REF!)), the form Excel
// writes, but the union refused the error literals as parts that are no references and answered
// #VALUE!, where a lone #REF!A1 or SUM(#REF!$A$1:$B$3) reads #REF!.

const REF = { error: '#REF!' };

describe('a union whose parts were deleted', () => {
  it('reads #REF! rather than #VALUE!', () => {
    expect(calc('SUM((#REF!,#REF!))')).toEqual(REF);
    expect(calc('SUM((A1,#REF!))', { A1: '5' })).toEqual(REF);
    expect(calc('AREAS((#REF!,#REF!))')).toEqual(REF);
    // A function that passes over errors passes over the union's #REF!, as it does a #REF!A1 reference and as COUNT(#REF!) does.
    expect(calc('COUNT((#REF!,A1:A3))', { A1: '5' })).toBe(0);
    expect(calc('COUNT((#REF!A1,A1:A3))', { A1: '5' })).toBe(0);
    expect(calc('COUNTA((#REF!,A1:A3))', { A1: '5' })).toBe(1);
    expect(calc('INDEX((#REF!,A1:A3),1,1,2)')).toEqual(REF);
    expect(calc('IFERROR(SUM((#REF!,#REF!)),"gone")')).toBe('gone');
    // A part that is a value, not a reference, is still #VALUE!.
    expect(calc('SUM((1,2))')).toEqual({ error: '#VALUE!' });
    expect(calc('SUM((A1,B1))', { A1: '5', B1: '7' })).toBe(12);
  });

  it('follows from deleting the rows a union names', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [1, 2, 3, 4, 5].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
    wb.setInput(id, 0, 2, '=SUM((A2,A5))');
    wb.setInput(id, 1, 2, '=SUM((A1,A5))');
    expect(wb.getValue(id, 0, 2)).toBe(7);
    wb.deleteRows(id, 1, 4);
    expect(wb.getCell(id, 0, 2).f).toBe('SUM((#REF!,#REF!))');
    expect(wb.getCell(id, 1, 2)?.f).toBeUndefined(); // its row went with the deletion
    expect(wb.getValue(id, 0, 2)).toEqual(REF);
    wb.undo();
    expect(wb.getValue(id, 0, 2)).toBe(7);
    expect(wb.getValue(id, 1, 2)).toBe(6);
  });
});
