import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// IF(x,,5) reads an explicitly empty value argument as 0 for every element of an array condition;
// IFERROR and IFNA over an array read an empty replacement the same way, rather than as "".
describe('IFERROR and IFNA over an array with the replacement left empty', () => {
  const at = (formula) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, formula);
    return wb.getValue(id, 0, 0);
  };

  it('fill the failing elements with 0', () => {
    expect(at('=INDEX(IFERROR(1/(SEQUENCE(3)-2),),2)')).toBe(0);
    expect(at('=INDEX(IFERROR(1/(SEQUENCE(3)-2),),1)')).toBe(-1);
    expect(at('=SUM(IFERROR(1/(SEQUENCE(3)-2),))')).toBe(0);
    expect(at('=INDEX(IFNA({1,#N/A,3},),2)')).toBe(0);
    expect(at('=INDEX(IF({TRUE,FALSE},,5),1)')).toBe(0);
  });

  it('still take a given replacement, and leave an array without errors as it is', () => {
    expect(at('=INDEX(IFERROR(1/(SEQUENCE(3)-2),"x"),2)')).toBe('x');
    expect(at('=INDEX(IFNA({1,#N/A,3},""),2)')).toBe('');
    expect(at('=SUM(IFERROR(SEQUENCE(3),))')).toBe(6);
  });
});
