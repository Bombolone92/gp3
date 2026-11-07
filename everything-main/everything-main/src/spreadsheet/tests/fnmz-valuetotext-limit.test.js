import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// The strict format wraps text in quotes, which can push a result past the 32,767
// characters a cell holds: #VALUE! then, as for REPT and ARRAYTOTEXT.
describe('VALUETOTEXT past the cell limit', () => {
  it('is #VALUE! when the quotes push the text over the limit', () => {
    expect(calc('VALUETOTEXT(REPT("a",32767),1)')).toEqual({ error: '#VALUE!' });
    expect(calc('VALUETOTEXT(REPT("a",32766),1)')).toEqual({ error: '#VALUE!' });
    expect(calc('LEN(VALUETOTEXT(REPT("a",32765),1))')).toBe(32767);
    expect(calc('LEN(VALUETOTEXT(REPT("a",32767)))')).toBe(32767);
    expect(calc('VALUETOTEXT("a",1)')).toBe('"a"');
    expect(calc('VALUETOTEXT(1.5,1)')).toBe('1.5');
  });
});
