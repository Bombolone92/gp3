import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// STDEVA, STDEVPA, VARA and VARPA count a referenced text cell as 0 and a boolean cell as 1 or 0
// whether the reference is one cell or a range, as AVERAGEA, MAXA and MINA do,
// instead of #VALUE! for =STDEVA(A1,A2) when A1 holds text: the evaluator collapsed a one-cell
// reference to its value, and the text was then coerced as a typed argument would be.
describe('the A-variant deviations over single-cell references', () => {
  const D = { A1: 'x', A2: '4', A3: 'TRUE', A4: '=1/0' };

  it('count a referenced text cell as 0', () => {
    expect(calc('STDEVA(A1,A2)', D)).toBe(Math.sqrt(8));
    expect(calc('STDEVA(A1:A2)', D)).toBe(Math.sqrt(8));
    expect(calc('STDEVPA(A1,A2)', D)).toBe(2);
    expect(calc('VARA(A1,A2)', D)).toBe(8);
    expect(calc('VARPA(A1,A2)', D)).toBe(4);
    expect(calc('VARPA(A1)', D)).toBe(0);
    expect(calc('STDEVPA(A1)', D)).toBe(0);
  });

  it('count a referenced boolean cell as 1 or 0', () => {
    expect(calc('VARA(A3,A2)', D)).toBe(4.5); // {1, 4}
    expect(calc('VARPA(A3,A2)', D)).toBe(2.25);
    expect(calc('STDEVPA(A3,A2)', D)).toBe(1.5);
  });

  it('still need two values for a sample, and carry an error cell', () => {
    expect(calc('STDEVA(A1)', D)).toEqual(E('#DIV/0!'));
    expect(calc('VARA(A1)', D)).toEqual(E('#DIV/0!'));
    expect(calc('VARA(A4,A2)', D)).toEqual(E('#DIV/0!'));
    expect(calc('STDEVPA(A2,A4)', D)).toEqual(E('#DIV/0!'));
  });

  it('still convert text typed as an argument, as AVERAGEA does', () => {
    expect(calc('VARA("3",5)')).toBe(2);
    expect(calc('STDEVA("x",4)')).toEqual(E('#VALUE!'));
    expect(calc('AVERAGEA(A1,A2)', D)).toBe(2);
  });
});
