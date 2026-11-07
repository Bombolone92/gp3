import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// SUMIF and AVERAGEIF keep a one-cell reference whole so that a one-cell sum range still carries
// its address, which also stopped the evaluator from reporting an error read from the criterion
// cell. SUMIF then matched nothing and answered 0, and AVERAGEIF #DIV/0!, while COUNTIFS,
// SUMIFS, AVERAGEIFS, MAXIFS and MINIFS over the same broken cell all answered the error.
const CELLS = { A1: '5', A2: '3', A3: '9', D1: '=NA()', D2: '=1/0' };

describe('a criterion read from a cell in error', () => {
  it.each([
    'SUMIF(A1:A3,D1,A1:A3)', 'SUMIF(A1:A3,D1)', 'AVERAGEIF(A1:A3,D1,A1:A3)', 'AVERAGEIF(A1:A3,D1)',
    'COUNTIFS(A1:A3,D1)', 'SUMIFS(A1:A3,A1:A3,D1)', 'AVERAGEIFS(A1:A3,A1:A3,D1)',
    'MAXIFS(A1:A3,A1:A3,D1)', 'MINIFS(A1:A3,A1:A3,D1)',
  ])('is reported by %s', (formula) => {
    expect(calc(formula, CELLS)).toEqual(E('#N/A'));
  });

  it('reports whichever error the cell holds, and the first of several', () => {
    expect(calc('SUMIF(A1:A3,D2,A1:A3)', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('AVERAGEIF(A1:A3,D2,A1:A3)', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('SUMIFS(A1:A3,A1:A3,D2,A1:A3,D1)', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('COUNTIFS(A1:A3,D1,A1:A3,D2)', CELLS)).toEqual(E('#N/A'));
  });

  it('leaves a sound criterion cell, a literal error and a criterion that names one alone', () => {
    const cells = { ...CELLS, D3: '3' };
    expect(calc('SUMIF(A1:A3,D3,A1:A3)', cells)).toBe(3);
    expect(calc('AVERAGEIF(A1:A3,D3,A1:A3)', cells)).toBe(3);
    expect(calc('SUMIF(A1:A3,">3",A1:A3)', cells)).toBe(14);
    expect(calc('SUMIF(A1:A3,NA(),A1:A3)', cells)).toEqual(E('#N/A'));
    // A criterion naming an error still matches the cells holding it, rather than being an error itself.
    expect(calc('COUNTIF(A1:A4,"#N/A")', { ...cells, A4: '=NA()' })).toBe(1);
    expect(calc('SUMIF(A1:A4,"<>#N/A",A1:A4)', { ...cells, A4: '=NA()' })).toBe(17);
  });

  it('still spills a criterion of several cells, error by error', () => {
    const cells = { ...CELLS, F1: '>3', F2: '=NA()' };
    expect(calc('SUM(IFERROR(SUMIF(A1:A3,F1:F2,A1:A3),-1))', cells)).toBe(13);
  });
});
