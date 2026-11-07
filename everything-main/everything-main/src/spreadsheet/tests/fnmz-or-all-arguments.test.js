import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// OR evaluates every argument (as do AND and XOR): text that is not TRUE or FALSE is
// #VALUE! and an error is that error, even after a TRUE has already been seen.
describe('OR reads every argument', () => {
  it('reports text or an error that follows a TRUE', () => {
    expect(calc('OR(TRUE,"a")')).toEqual({ error: '#VALUE!' });
    expect(calc('OR(FALSE,"a")')).toEqual({ error: '#VALUE!' });
    expect(calc('OR(TRUE,A1)', { A1: '=1/0' })).toEqual({ error: '#DIV/0!' });
    expect(calc('OR(TRUE,A1:A2)', { A1: 'FALSE', A2: '=NA()' })).toEqual({ error: '#N/A' });
    expect(calc('XOR(TRUE,"a")')).toEqual({ error: '#VALUE!' });
    expect(calc('XOR(TRUE,A1)', { A1: '=1/0' })).toEqual({ error: '#DIV/0!' });
  });

  it('still answers TRUE or FALSE from arguments it can read', () => {
    expect(calc('OR(TRUE,"TRUE")')).toBe(true);
    expect(calc('OR(TRUE,FALSE,0)')).toBe(true);
    expect(calc('OR(FALSE,0)')).toBe(false);
    expect(calc('OR(TRUE,A1)', { A1: 'abc' })).toBe(true); // text in a referenced cell is skipped
    expect(calc('OR(TRUE,A1:A3)', { A1: 'abc', A2: '', A3: 'FALSE' })).toBe(true);
    expect(calc('OR(A1)', { A1: 'abc' })).toEqual({ error: '#VALUE!' }); // nothing logical at all
  });
});
