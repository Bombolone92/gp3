import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

function arr(formula, cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, String(text)); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

// TEXTSPLIT hands back every piece as the text it was, so a postal code keeps its
// leading zeros and "1.50" its decimal, and SUM(TEXTSPLIT(...)) is 0 until VALUE or -- converts the
// pieces. SPLIT keeps reading numbers and booleans from the pieces, as it does in Google Sheets.
describe('TEXTSPLIT pieces stay text', () => {
  it('keeps leading zeros, decimals, exponents and spaces', () => {
    expect(arr('TEXTSPLIT("007,008",",")')).toEqual([['007', '008']]);
    expect(arr('TEXTSPLIT("1.50,2",",")')).toEqual([['1.50', '2']]);
    expect(arr('TEXTSPLIT("1e3, TRUE ",",")')).toEqual([['1e3', ' TRUE ']]);
    expect(arr('TEXTSPLIT("10,20;30,40",",",";")')).toEqual([['10', '20'], ['30', '40']]);
    expect(calc('ISTEXT(INDEX(TEXTSPLIT("7,8",","),1,1))')).toBe(true);
    expect(calc('LEN(INDEX(TEXTSPLIT("007,8",","),1,1))')).toBe(3);
  });

  it('sums to 0 until the pieces are converted', () => {
    expect(calc('SUM(TEXTSPLIT("1,2,3",","))')).toBe(0);
    expect(calc('SUM(VALUE(TEXTSPLIT("1,2,3",",")))')).toBe(6);
    expect(calc('SUM(--TEXTSPLIT("1,2,3",","))')).toBe(6);
  });

  it('leaves pad_with as the value given', () => {
    expect(arr('TEXTSPLIT("a,b;c",",",";",TRUE,0,0)')).toEqual([['a', 'b'], ['c', 0]]);
  });

  it('while SPLIT still reads numbers and booleans', () => {
    expect(arr('SPLIT("007,1.50,TRUE,x",",")')).toEqual([[7, 1.5, true, 'x']]);
    expect(calc('SUM(SPLIT("1,2,3",","))')).toBe(6);
  });
});
