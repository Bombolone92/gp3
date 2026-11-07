import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function calc(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, `=${formula}`);
  return wb.getValue(id, 0, 0);
}

const VALUE = { error: '#VALUE!' };

// XLOOKUP and XMATCH accept search_mode 1, -1, 2 and -2 only.
describe('XLOOKUP and XMATCH search_mode', () => {
  it('reject any other search mode', () => {
    expect(calc('XMATCH(2,{1,2,3},0,3)')).toEqual(VALUE);
    expect(calc('XMATCH(2,{1,2,3},0,0)')).toEqual(VALUE);
    expect(calc('XMATCH(2,{1,2,3},0,-3)')).toEqual(VALUE);
    expect(calc('XLOOKUP(2,{1,2,3},{"a","b","c"},,0,3)')).toEqual(VALUE);
    expect(calc('XLOOKUP(2,{1,2,3},{"a","b","c"},"none",0,0)')).toEqual(VALUE);
  });

  // match_mode was judged only after a binary search (search_mode 2 or -2) had taken the call, so
  // any match_mode passed with those search modes; the answer is #VALUE! whatever the search mode.
  it('reject an invalid match mode whatever the search mode', () => {
    expect(calc('XMATCH(2,{1,2,3},5,2)')).toEqual(VALUE);
    expect(calc('XMATCH(2,{3,2,1},3,-2)')).toEqual(VALUE);
    expect(calc('XMATCH(2,{1,2,3},5,1)')).toEqual(VALUE);
    expect(calc('XLOOKUP(1,{1,2,3},{"a","b","c"},,5,2)')).toEqual(VALUE);
    expect(calc('XLOOKUP(1,{1,2,3},{"a","b","c"},"none",-3,-2)')).toEqual(VALUE);
    expect(calc('XMATCH(2,{1,2,3},1,2)')).toBe(2);
    expect(calc('XMATCH(2.5,{1,2,3},-1,2)')).toBe(2);
    expect(calc('XMATCH(2.5,{1,2,3},1,2)')).toBe(3);
    expect(calc('XMATCH(2.5,{3,2,1},-1,-2)')).toBe(2);
  });

  it('still search in the four documented modes', () => {
    expect(calc('XMATCH(2,{1,2,3},0,1)')).toBe(2);
    expect(calc('XMATCH(2,{1,2,3},0,-1)')).toBe(2);
    expect(calc('XMATCH(2,{1,2,3},0,2)')).toBe(2);
    expect(calc('XMATCH(2,{3,2,1},0,-2)')).toBe(2);
    expect(calc('XLOOKUP(2,{1,2,3},{"a","b","c"},,0,-1)')).toBe('b');
    expect(calc('XLOOKUP(2,{1,2,3},{"a","b","c"},,0,2)')).toBe('b');
  });
});
