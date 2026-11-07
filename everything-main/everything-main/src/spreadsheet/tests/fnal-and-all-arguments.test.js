import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// AND evaluates every argument (as do OR and XOR): text that is not TRUE or FALSE is
// #VALUE! and an error is that error, even after a FALSE has already been seen.
describe('AND reads every argument', () => {
  it('reports text or an error that follows a FALSE', () => {
    expect(calc('AND(FALSE,"a")')).toEqual({ error: '#VALUE!' });
    expect(calc('AND(TRUE,"a")')).toEqual({ error: '#VALUE!' });
    expect(calc('AND(FALSE,A1)', { A1: '=1/0' })).toEqual({ error: '#DIV/0!' });
    expect(calc('AND(FALSE,A1:A2)', { A1: 'TRUE', A2: '=NA()' })).toEqual({ error: '#N/A' });
    expect(calc('AND(0,"1e999")')).toEqual({ error: '#VALUE!' }); // text that is no logical value, after a FALSE
  });

  it('still answers TRUE or FALSE from arguments it can read', () => {
    expect(calc('AND(FALSE,"TRUE")')).toBe(false);
    expect(calc('AND(FALSE,TRUE,1)')).toBe(false);
    expect(calc('AND(TRUE,1,"TRUE")')).toBe(true);
    expect(calc('AND(FALSE,A1)', { A1: 'abc' })).toBe(false); // text in a referenced cell is skipped
    expect(calc('AND(FALSE,A1:A3)', { A1: 'abc', A2: '', A3: 'TRUE' })).toBe(false);
    expect(calc('AND(A1)', { A1: 'abc' })).toEqual({ error: '#VALUE!' }); // nothing logical at all
  });
});
