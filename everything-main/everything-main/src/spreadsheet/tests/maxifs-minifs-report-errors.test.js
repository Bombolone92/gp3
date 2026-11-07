import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// MAXIFS and MINIFS read only the numbers out of their value range, so a cell holding a broken
// formula was neither taken nor reported and the tile showed a plausible largest sale beside it.
// Every sibling in the app reports it: SUMIFS, AVERAGEIFS, SUMIF, MAX, MIN, LARGE, MEDIAN, DMAX,
// SUBTOTAL(4) and AGGREGATE(4,0). Only AGGREGATE's skip-errors options may leave it out.
const CELLS = { A1: 'x', A2: 'y', A3: 'x', B1: '10', B2: '=1/0', B3: '30' };

describe('MAXIFS and MINIFS over a value range holding an error', () => {
  it('reports the error when the criteria reach the cell holding it', () => {
    expect(calc('MAXIFS(B1:B3,A1:A3,"y")', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('MINIFS(B1:B3,A1:A3,"y")', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('MAXIFS(B1:B3,A1:A3,"*")', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('MINIFS(B1:B3,A1:A3,"<>")', CELLS)).toEqual(E('#DIV/0!'));
    // The same answer as every sibling gives over the same data.
    expect(calc('SUMIFS(B1:B3,A1:A3,"y")', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('AVERAGEIFS(B1:B3,A1:A3,"y")', CELLS)).toEqual(E('#DIV/0!'));
    expect(calc('MAX(B1:B3)', CELLS)).toEqual(E('#DIV/0!'));
  });

  it('propagates whichever error the matching cells hold', () => {
    const cells = { ...CELLS, B2: '=NA()' };
    expect(calc('MAXIFS(B1:B3,A1:A3,"y")', cells)).toEqual(E('#N/A'));
    expect(calc('MINIFS(B1:B3,A1:A3,"y")', cells)).toEqual(E('#N/A'));
  });

  it('leaves an error the criteria pass over alone', () => {
    expect(calc('MAXIFS(B1:B3,A1:A3,"x")', CELLS)).toBe(30);
    expect(calc('MINIFS(B1:B3,A1:A3,"x")', CELLS)).toBe(10);
    expect(calc('SUMIFS(B1:B3,A1:A3,"x")', CELLS)).toBe(40);
    expect(calc('MAXIFS(B1:B3,A1:A3,"x",B1:B3,">20")', CELLS)).toBe(30);
    expect(calc('MAXIFS(B1:B3,A1:A3,"z")', CELLS)).toBe(0);
    expect(calc('MINIFS(B1:B3,A1:A3,"z")', CELLS)).toBe(0);
  });

  it('still leaves text and blanks out without reporting them', () => {
    const cells = { A1: 'x', A2: 'x', A3: 'x', A4: 'x', B1: '10', B2: 'text', B4: '30' };
    expect(calc('MAXIFS(B1:B4,A1:A4,"x")', cells)).toBe(30);
    expect(calc('MINIFS(B1:B4,A1:A4,"x")', cells)).toBe(10);
  });
});
