import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// ROMAN takes a form: 0 or TRUE is classic, 1 to 3 let a subtracted
// numeral stand one to three steps further from the numeral it is taken from
// (450 as LD, 490 as XD, 495 as VD), and 4 or FALSE is the shortest spelling.
// The 499 values are the function's documented examples.
describe('ROMAN forms', () => {
  it.each([
    ['ROMAN(499,0)', 'CDXCIX'],
    ['ROMAN(499,1)', 'LDVLIV'],
    ['ROMAN(499,2)', 'XDIX'],
    ['ROMAN(499,3)', 'VDIV'],
    ['ROMAN(499,4)', 'ID'],
    ['ROMAN(499)', 'CDXCIX'],
    ['ROMAN(499,TRUE)', 'CDXCIX'],
    ['ROMAN(499,FALSE)', 'ID'],
    ['ROMAN(2013,0)', 'MMXIII'],
    ['ROMAN(999,1)', 'LMVLIV'],
    ['ROMAN(999,2)', 'XMIX'],
    ['ROMAN(999,3)', 'VMIV'],
    ['ROMAN(999,4)', 'IM'],
    ['ROMAN(3999,4)', 'MMMIM'],
    ['ROMAN(490,1)', 'LDXL'],
    ['ROMAN(45,1)', 'VL'],
    ['ROMAN(48,2)', 'VLIII'],
    ['ROMAN(98,1)', 'VCIII'],
    ['ROMAN(449,4)', 'CDIL'],
    ['ROMAN(1994,4)', 'MXMIV'],
    ['ROMAN(8,4)', 'VIII'],
    ['ROMAN(0,4)', ''],
    ['ROMAN(1.9,1.9)', 'I'],
  ])('%s → %s', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it('every form reads back to the same number', () => {
    for (let n = 1; n < 4000; n += 37) {
      for (let form = 0; form <= 4; form++) {
        expect(calc(`ARABIC(ROMAN(${n},${form}))`)).toBe(n);
      }
    }
  });

  it('refuses a form outside 0 to 4', () => {
    expect(calc('ROMAN(499,5)')).toEqual({ error: '#VALUE!' });
    expect(calc('ROMAN(499,-1)')).toEqual({ error: '#VALUE!' });
    expect(calc('ROMAN(499,"x")')).toEqual({ error: '#VALUE!' });
    expect(calc('ROMAN(4000,4)')).toEqual({ error: '#VALUE!' });
  });
});
