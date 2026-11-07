import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// An empty format code shows nothing of the value: TEXT(1234.5,"") is "", not the
// number written the General way as though the code had been left out.
it('TEXT with an empty format code is the empty text', () => {
  expect(calc('TEXT(1234.5,"")')).toBe('');
  expect(calc('TEXT(0,"")')).toBe('');
  expect(calc('TEXT(-1,"")')).toBe('');
  expect(calc('TEXT(A1,"")', { A1: '45306' })).toBe('');
  expect(calc('LEN(TEXT(1234.5,""))')).toBe(0);
  // A code that names the General format, or one left out, still writes the number.
  expect(calc('TEXT(1234.5,"General")')).toBe('1234.5');
  expect(calc('TEXT(1234.5,"0.0")')).toBe('1234.5');
});
