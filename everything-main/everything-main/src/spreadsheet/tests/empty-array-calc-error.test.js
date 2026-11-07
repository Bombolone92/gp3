import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function book(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, `=${formula}`);
  return { wb, id };
}
const calc = (formula) => { const { wb, id } = book(formula); return wb.getValue(id, 0, 0); };
const arr = (formula) => {
  const { wb, id } = book(formula);
  const range = wb.spillRangeAt(id, 0, 0) || { r1: 0, c1: 0, r2: 0, c2: 0 };
  return wb.rangeValues(id, range);
};

const CALC = { error: '#CALC!' };

// An array with no rows or no columns is the empty array, #CALC!.
describe('SEQUENCE and RANDARRAY with no rows or columns', () => {
  it('are #CALC! rather than #VALUE!', () => {
    expect(calc('SEQUENCE(0)')).toEqual(CALC);
    expect(calc('SEQUENCE(1,0)')).toEqual(CALC);
    expect(calc('SEQUENCE(-1)')).toEqual(CALC);
    expect(calc('RANDARRAY(0)')).toEqual(CALC);
    expect(calc('RANDARRAY(1,0)')).toEqual(CALC);
  });

  it('keep #VALUE! for other bad arguments and still build arrays', () => {
    expect(calc('RANDARRAY(1,1,3,1)')).toEqual({ error: '#VALUE!' });
    expect(arr('SEQUENCE(2,2)')).toEqual([[1, 2], [3, 4]]);
    expect(arr('RANDARRAY(1,2,5,5,TRUE)')).toEqual([[5, 5]]);
  });
});
