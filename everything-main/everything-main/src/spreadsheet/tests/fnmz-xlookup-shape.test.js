import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// XLOOKUP's return_array runs alongside lookup_array (row for row, or column for column);
// the answer is #VALUE! when the two differ in length there, whether or not the value is found.
const VALUE = { error: '#VALUE!' };
const DATA = { A1: 'a', A2: 'b', A3: 'c', B1: 1, B2: 2, B3: 3, B4: 4, D1: 'x', E1: 'y', F1: 'z', D2: 10, E2: 20, F2: 30, D3: 11, E3: 21, F3: 31 };

describe('XLOOKUP with a return array of another length', () => {
  it('is #VALUE! whether the value is found or not, and regardless of if_not_found', () => {
    expect(calc('XLOOKUP("c",A1:A3,B1:B2)', DATA)).toEqual(VALUE);
    expect(calc('XLOOKUP("c",A1:A3,B1:B2,"none")', DATA)).toEqual(VALUE);
    expect(calc('XLOOKUP("a",A1:A3,B1:B2)', DATA)).toEqual(VALUE);
    expect(calc('XLOOKUP("a",A1:A3,B1:B4)', DATA)).toEqual(VALUE);
    expect(calc('XLOOKUP("a",A1:A3,B1:B1)', DATA)).toEqual(VALUE);
    expect(calc('XLOOKUP(2,{1,2,3},{"a","b"})')).toEqual(VALUE);
    expect(calc('XLOOKUP("y",D1:F1,D2:E3)', DATA)).toEqual(VALUE);
  });

  it('still answers when the lengths agree', () => {
    expect(calc('XLOOKUP("b",A1:A3,B1:B3)', DATA)).toBe(2);
    expect(calc('XLOOKUP("q",A1:A3,B1:B3,"none")', DATA)).toBe('none');
    expect(calc('XLOOKUP(2,{1,2,3},{"a","b","c"})')).toBe('b');
    expect(calc('ROWS(XLOOKUP("y",D1:F1,D2:F3))', DATA)).toBe(2);
    expect(calc('INDEX(XLOOKUP("y",D1:F1,D2:F3),2,1)', DATA)).toBe(21);
    expect(calc('XLOOKUP("b",A1:A3000,B1:B3000)', DATA)).toBe(2);
  });
});
