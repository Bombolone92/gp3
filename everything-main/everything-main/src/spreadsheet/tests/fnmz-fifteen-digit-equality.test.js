import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// Operators and criteria compare the rounded 15-digit view of a number.
// Lookups and ranking distinguish its stored binary value instead.
const NA = { error: '#N/A' };
const CELLS = { A1: '=1.1*3', B1: 'yes', A2: '1', B2: 'no', A3: '5', B3: 'more', C1: '3.3' };

describe('numbers equal at 15 significant digits', () => {
  it('match the = operator but remain distinct in exact lookups', () => {
    expect(calc('1.1*3=3.3')).toBe(true);
    expect(calc('MATCH(1.1*3,{3.3},0)')).toEqual(NA);
    expect(calc('MATCH(3.3,A1:A3,0)', CELLS)).toEqual(NA);
    expect(calc('XMATCH(1.1*3,{3.3})')).toEqual(NA);
    expect(calc('XMATCH(3.3,A1:A3,2)', CELLS)).toEqual(NA);
    expect(calc('XMATCH(3.3,A1:A3,0,-1)', CELLS)).toEqual(NA);
    expect(calc('VLOOKUP(3.3,A1:B3,2,FALSE)', CELLS)).toEqual(NA);
    expect(calc('HLOOKUP(1.1*3,{3.3,1;"yes","no"},2,FALSE)')).toEqual(NA);
    expect(calc('XLOOKUP(3.3,A1:A3,B1:B3)', CELLS)).toEqual(NA);
    expect(calc('MATCH(3.4,A1:A3,0)', CELLS)).toEqual(NA);
  });

  it('match numeric criteria, and are neither above nor below them', () => {
    expect(calc('COUNTIF(A1:A3,3.3)', CELLS)).toBe(1);
    expect(calc('COUNTIF(A1:A3,C1)', CELLS)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"=3.3")', CELLS)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"<>3.3")', CELLS)).toBe(2);
    expect(calc('COUNTIF(A1:A3,">=3.3")', CELLS)).toBe(2);
    expect(calc('COUNTIF(A1:A3,">3.3")', CELLS)).toBe(1);
    expect(calc('COUNTIF(A1:A3,"<=3.3")', CELLS)).toBe(2);
    expect(calc('COUNTIF(A1:A3,"<3.3")', CELLS)).toBe(1);
    expect(calc('SUMIF(A1:A3,1.1*3,A1:A3)', CELLS)).toBeCloseTo(3.3, 12);
    expect(calc('SUMIFS(A1:A3,A1:A3,3.3)', CELLS)).toBeCloseTo(3.3, 12);
  });

  it('rank distinct stored numbers separately', () => {
    expect(calc('RANK(3.3,A1:A3)', CELLS)).toEqual(NA);
    expect(calc('RANK(1.1*3,{3.3,1,5},1)')).toEqual(NA);
    expect(calc('RANK(3.3,{3.3,1;5,2})')).toBe(2);
    expect(calc('RANK.EQ(3.3,A1:A3)', CELLS)).toEqual(NA);
    expect(calc('RANK.AVG(3.3,A1:C1)', CELLS)).toBe(2);
    expect(calc('RANK.AVG(1.1*3,{3.3,1,5})')).toEqual(NA);
    expect(calc('RANK(3.4,A1:A3)', CELLS)).toEqual(NA);
  });
});
