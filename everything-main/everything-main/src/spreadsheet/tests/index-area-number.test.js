import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

const CELLS = { A1: '7', B1: '8', C1: '9', A2: '1', B2: '2', C2: '3', E1: '40', F1: '50' };

function calc(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(CELLS)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 9, 9, `=${formula}`);
  return wb.getValue(id, 9, 9);
}

const REF = { error: '#REF!' };

// area_num picks one area of a union; a plain reference has only area 1.
describe('INDEX area_num on a single area', () => {
  it('is #REF! for any area other than 1', () => {
    expect(calc('INDEX(A1:C2,1,1,2)')).toEqual(REF);
    expect(calc('INDEX(A1:C2,1,1,0)')).toEqual(REF);
    expect(calc('INDEX({1,2},1,1,2)')).toEqual(REF);
  });

  it('still answers for area 1 and for unions', () => {
    expect(calc('INDEX(A1:C2,1,1,1)')).toBe(7);
    expect(calc('INDEX(A1:C2,2,3)')).toBe(3);
    expect(calc('INDEX((A1:C2,E1:F1),1,2,2)')).toBe(50);
    expect(calc('INDEX((A1:C2,E1:F1),1,2,3)')).toEqual(REF);
  });
});
