import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// Empty text is text: where a number is needed it is #VALUE!, whether typed, from a
// formula that answered "", or through a function's own argument. Only a blank cell reads as 0.
describe('empty text where a number is needed', () => {
  const VALUE = { error: '#VALUE!' };

  it.each(['""+1', '" "+1', '1-""', '2*""', '-""', '""%', 'VALUE("")', 'VALUE(" ")', 'SUM(1,"")', 'ROUND("",2)', 'ABS("")', 'IF("",1,2)', 'AND("")', 'OR("")', 'NOT("")'])
    ('%s is #VALUE!', (formula) => {
      expect(calc(formula)).toEqual(VALUE);
    });

  it('carries from a formula that answered "" into arithmetic on it', () => {
    expect(calc('A1+1', { A1: '=IF(B1="","",B1*2)' })).toEqual(VALUE);
    expect(calc('A1+1', { A1: '=IF(B1="","",B1*2)', B1: '4' })).toBe(9);
    expect(calc('A1*2', { A1: '=""' })).toEqual(VALUE);
  });

  it('keeps blank cells as 0, ignores text inside ranges, and leaves comparisons and & alone', () => {
    expect(calc('A1+1')).toBe(1);
    expect(calc('-A1')).toBe(0); // Native unary negation preserves the blank's positive zero.
    expect(calc('SUM(A1:A2)', { A1: '=""', A2: '3' })).toBe(3);
    expect(calc('AVERAGE(A1:A2)', { A1: '=""', A2: '3' })).toBe(3);
    expect(calc('COUNT(A1:A2)', { A1: '=""', A2: '3' })).toBe(1);
    expect(calc('SUMPRODUCT(A1:A2,B1:B2)', { A1: '=""', A2: '3', B1: '2', B2: '2' })).toBe(6);
    expect(calc('""=0')).toBe(false);
    expect(calc('""<1')).toBe(false);
    expect(calc('A1=""')).toBe(true);
    expect(calc('""&1')).toBe('1');
    expect(calc('N("")')).toBe(0);
    expect(calc('NUMBERVALUE("")')).toBe(0);
    expect(calc('COUNTIF(A1:A2,"")', { A1: '=""', A2: '3' })).toBe(1);
  });
});
