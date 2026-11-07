import { describe, it, expect } from 'vitest';
import { MAX_FORMAT_CODE_LENGTH } from '../src/core/numfmt.js';
import { calc } from './helpers/calc.js';

// A format code is at most 255 characters everywhere else a code arrives (a file, a paste, the dialog);
// TEXT refuses a longer one with #VALUE! too, rather than formatting through a 30,000-character code on
// every recalculation or answering a 300-character string.

const VALUE = { error: '#VALUE!' };

describe('TEXT with a format code past the length limit', () => {
  it('is #VALUE!, at once', { timeout: 60000 }, () => {
    expect(MAX_FORMAT_CODE_LENGTH).toBe(255);
    const t = performance.now();
    expect(calc('TEXT(1,REPT("0",300))')).toEqual(VALUE);
    expect(calc('TEXT(1,"0"&REPT(",",30000))')).toEqual(VALUE);
    expect(calc('TEXT("x",REPT("@",300))')).toEqual(VALUE);
    expect(calc('TEXT(A1,REPT("0",256))', { A1: 5 })).toEqual(VALUE);
    expect(performance.now() - t).toBeLessThan(500); // the 30,000-comma code cost over a second to scan
  });

  it('formats through a code of the limit\'s length and shorter as before', () => {
    expect(calc('TEXT(1,REPT("0",255))')).toBe('0'.repeat(254) + '1');
    expect(calc('LEN(TEXT(1,REPT("0",255)))')).toBe(255);
    expect(calc('TEXT(1234.5,"#,##0.00")')).toBe('1,234.50');
    expect(calc('TEXT(0.5,"h:mm")')).toBe('12:00');
  });
});
