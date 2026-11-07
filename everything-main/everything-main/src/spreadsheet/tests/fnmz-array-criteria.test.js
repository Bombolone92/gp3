import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

// SUMIF, COUNTIF and their *IFS siblings are lifted over the criteria argument: an
// array constant (or a multi-cell range) as the criterion gives one answer per element,
// in the criterion's shape, which is how =SUM(COUNTIF(rng,{"x","y"})) counts cells equal
// to either value.
const DATA = { A1: 'x', A2: 'y', A3: 'x', A4: 'z', B1: 1, B2: 2, B3: 4, B4: 8, C1: 'x', C2: 'y', D1: 'x', D2: '=NA()' };
const E = (code) => ({ error: code });
const text = (formula, cells = DATA) => calc(`ARRAYTOTEXT(${formula},1)`, cells);

describe('array criteria in the *IF family', () => {
  it('COUNTIF and SUMIF answer per criterion, in the criterion shape', () => {
    expect(calc('SUM(COUNTIF(A1:A4,{"x","y"}))', DATA)).toBe(3);
    expect(text('COUNTIF(A1:A4,{"x","y"})')).toBe('{2,1}');
    expect(text('COUNTIF(A1:A4,C1:C2)')).toBe('{2;1}');
    expect(text('SUMIF(A1:A4,{"x","y"},B1:B4)')).toBe('{5,2}');
    expect(text('SUMIF(A1:A4,{"x";"y";"q"},B1:B4)')).toBe('{5;2;0}');
  });

  it('SUMIFS, AVERAGEIF(S), MAXIFS, MINIFS and COUNTIFS lift the same way', () => {
    expect(text('SUMIFS(B1:B4,A1:A4,{"x","y"})')).toBe('{5,2}');
    expect(text('SUMIFS(B1:B4,B1:B4,">"&{1,2})')).toBe('{14,12}');
    expect(text('AVERAGEIF(A1:A4,{"x","y"},B1:B4)')).toBe('{2.5,2}');
    expect(text('AVERAGEIFS(B1:B4,A1:A4,{"x","y"})')).toBe('{2.5,2}');
    expect(text('MAXIFS(B1:B4,A1:A4,{"x","y"})')).toBe('{4,2}');
    expect(text('MINIFS(B1:B4,A1:A4,{"x","y"})')).toBe('{1,2}');
    expect(text('COUNTIFS(A1:A4,{"x";"y"},B1:B4,">1")')).toBe('{1;1}');
  });

  it('broadcasts a row and a column criterion into a grid, and pads a shorter array with #N/A', () => {
    expect(text('COUNTIFS(A1:A4,{"x","y"},B1:B4,{">0";">3"})')).toBe('{2,1;1,0}');
    expect(text('COUNTIFS(A1:A4,{"x","y","z"},B1:B4,{">0",">1"})')).toBe('{2,1,#N/A}');
  });

  it('counts error criteria in COUNTIF and keeps scalar criteria as they were', () => {
    expect(text('COUNTIF(A1:A4,D1:D2)')).toBe('{2;0}');
    expect(calc('COUNTIF(A1:A4,"x")', DATA)).toBe(2);
    expect(calc('COUNTIF(A1:A4,C1)', DATA)).toBe(2);
    expect(calc('SUMIFS(B1:B4,A1:A4,C2)', DATA)).toBe(2);
    expect(calc('AVERAGEIF(A1:A4,"q",B1:B4)', DATA)).toEqual(E('#DIV/0!'));
  });
});
