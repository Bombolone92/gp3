import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A function that overflows or runs off the calendar must answer an error
// the error functions can see, never a NaN or Infinity that counts as a number.
describe('non-finite function results', () => {
  const book = () => { const wb = new Workbook(); return { wb, id: wb.activeSheetId }; };
  const at = (wb, id, f) => { wb.setInput(id, 9, 9, f); return wb.getValue(id, 9, 9); };

  it('become #NUM! that IFERROR, ISERROR, COUNT and MAX all see', () => {
    const { wb, id } = book();
    wb.setInput(id, 0, 0, '=YEAR(1E10)');
    wb.setInput(id, 1, 0, '=SUM((1E307*10),(1E307*10))');
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#NUM!' });
    expect(wb.getValue(id, 1, 0)).toEqual({ error: '#NUM!' });
    expect(at(wb, id, '=IFERROR(YEAR(1E10),"caught")')).toBe('caught');
    expect(at(wb, id, '=ISERROR(YEAR(1E10))')).toBe(true);
    expect(at(wb, id, '=ISNUMBER(SUM((1E307*10),(1E307*10)))')).toBe(false);
    expect(at(wb, id, '=COUNT(A1:A2)')).toBe(0);
    expect(at(wb, id, '=MAX(A1:A2)')).toEqual({ error: '#NUM!' });
    expect(at(wb, id, '=ROUND(1.5,400)')).toEqual({ error: '#NUM!' });
    expect(at(wb, id, '=VALUE("1e999")')).toEqual({ error: '#VALUE!' }); // failed text conversion precedes arithmetic
    expect(at(wb, id, '=SUM(SEQUENCE(3)*(1E307*10))')).toEqual({ error: '#NUM!' });
    expect(at(wb, id, '=IFERROR(INDEX(SEQUENCE(3)*(1E307*10),3),"caught")')).toBe('caught');
  });

  it('keep ordinary answers, including large finite ones', () => {
    const { wb, id } = book();
    expect(at(wb, id, '=YEAR(45000)')).toBe(2023);
    expect(at(wb, id, '=SUM(1E307,1E307)')).toBe(2e307);
    expect(at(wb, id, '=ROWS(SEQUENCE(3)*2)')).toBe(3);
  });

  it('report a text significance to CEILING.MATH and FLOOR.MATH as #VALUE!', () => {
    const { wb, id } = book();
    expect(at(wb, id, '=CEILING.MATH(5,"abc")')).toEqual({ error: '#VALUE!' });
    expect(at(wb, id, '=FLOOR.MATH(5,"abc")')).toEqual({ error: '#VALUE!' });
    expect(at(wb, id, '=CEILING.MATH(5.3,2)')).toBe(6);
    expect(at(wb, id, '=FLOOR.MATH(-5.3,2,1)')).toBe(-4);
  });
});
