import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const calc = (formula) => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, formula);
  return wb.getValue(wb.activeSheetId, 0, 0);
};

// 0.3 / 0.1 is 2.9999999999999996 in binary, so a raw quotient floors to the
// wrong step. The step is now decided on the value's 15 significant digits,
// the way ROUND here already did.
describe('rounding to a step on 15 significant digits', () => {
  it.each([
    ['=FLOOR(0.3,0.1)', 0.3],
    ['=FLOOR(1.15,0.05)', 1.15],
    ['=FLOOR(2.3,0.1)', 2.3],
    ['=FLOOR(4.1,0.1)', 4.1],
    ['=FLOOR(7.3,0.5)', 7],
    ['=CEILING(4.2,0.7)', 4.2],
    ['=CEILING(4.3,0.7)', 4.9],
    ['=CEILING(0.3,0.1)', 0.3],
    ['=FLOOR.MATH(0.3,0.1)', 0.3],
    ['=CEILING.MATH(1.15,0.05)', 1.15],
    ['=FLOOR.PRECISE(2.3,0.1)', 2.3],
    ['=MROUND(0.3,0.1)', 0.3],
    ['=MROUND(7,3)', 6],
    ['=MROUND(8,3)', 9],
    ['=MROUND(-2.5,-1)', -3],
    ['=MROUND(-7,-2)', -8],
    ['=MROUND(2.5,1)', 3],
  ])('%s → %s', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it.each([
    ['=ROUNDUP(5E-10,0)', 1],
    ['=ROUNDUP(2.000000001,0)', 3],
    ['=ROUNDDOWN(2.999999999,0)', 2],
    ['=ROUNDUP(1E-12,2)', 0.01],
    ['=ROUNDUP(1.1*3,1)', 3.3],
    ['=ROUNDDOWN(1.1*3,1)', 3.3],
    ['=ROUNDUP(-3.14159,2)', -3.15],
    ['=ROUNDDOWN(-3.14159,2)', -3.14],
    ['=ROUNDUP(0,0)', 0],
  ])('%s → %s', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it('keeps the error answers', () => {
    expect(calc('=FLOOR(5,0)')).toEqual({ error: '#DIV/0!' });
    expect(calc('=FLOOR(5,-1)')).toEqual({ error: '#NUM!' });
    expect(calc('=MROUND(5,-1)')).toEqual({ error: '#NUM!' });
    expect(calc('=CEILING(5,0)')).toBe(0);
  });
});
