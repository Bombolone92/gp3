import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The cell-by-cell lifting of a10e01b named the math, text and date functions only, so every
// finance, engineering, complex, base-conversion and operator function, and HYPERLINK, ENCODEURL
// and ADDRESS, answered #VALUE! for an array where they should spill: PMT({0.05;0.06}/12,360,100000),
// the classic rate-sensitivity table, was #VALUE!. The functions that read a range as a whole
// (NPV, IRR, IMSUM, MMULT, ...) stay out.
describe('single-value finance, engineering and operator functions over arrays', () => {
  const column = (formula, n) => Array.from({ length: n }, (_, i) => calc(`INDEX(${formula},${i + 1},1)`));
  const round6 = (v) => Math.round(v * 1e6) / 1e6;

  it('spill one answer per element', () => {
    const pmt = column('PMT({0.05;0.06}/12,360,100000)', 2);
    expect(pmt[0]).toBeCloseTo(-536.82, 2);
    expect(pmt[1]).toBeCloseTo(-599.55, 2);
    expect(column('EFFECT({0.05;0.06},12)', 2).map(round6)).toEqual([0.051162, 0.061678]);
    expect(column('DDB(100,10,5,{1;2})', 2)).toEqual([40, 24]);
    expect(calc('COLUMNS(CUMIPMT(0.005,60,10000,1,{6,12},0))')).toBe(2);
    expect(column('CONVERT({1;2},"m","ft")', 2).map(round6)).toEqual([3.28084, 6.56168]);
    expect(column('DEC2BIN({1;2})', 2)).toEqual(['1', '10']);
    expect(column('HEX2DEC({"A";"FF"})', 2)).toEqual([10, 255]);
    expect(column('BITAND({1;3},1)', 2)).toEqual([1, 1]);
    expect(column('DELTA({1;2},1)', 2)).toEqual([1, 0]);
    expect(calc('ROWS(ERF({0.5;1}))')).toBe(2);
    expect(column('IMABS({"3+4i";"1"})', 2)).toEqual([5, 1]);
    expect(column('COMPLEX({1;2},1)', 2)).toEqual(['1+i', '2+i']);
    expect(column('EQ({1;2},1)', 2)).toEqual([true, false]);
    expect(column('ADD({1;2},1)', 2)).toEqual([2, 3]);
    expect(column('POW({2;3},2)', 2)).toEqual([4, 9]);
    expect(column('ENCODEURL({"a b";"c&d"})', 2)).toEqual(['a%20b', 'c%26d']);
    expect(column('HYPERLINK({"https://a.example";"https://b.example"})', 2)).toEqual(['https://a.example', 'https://b.example']);
    expect(column('ADDRESS({1;2},1)', 2)).toEqual(['$A$1', '$A$2']);
  });

  it('spill down a range and sum inside an aggregate', () => {
    const cells = { A1: 0.05, A2: 0.06, A3: 0.07 };
    expect(calc('ROWS(PMT(A1:A3/12,360,100000))', cells)).toBe(3);
    expect(calc('INDEX(PMT(A1:A3/12,360,100000),3,1)', cells)).toBeCloseTo(-665.30, 2);
    expect(calc('SUM(BITAND({1;3;5},1))')).toBe(3);
    expect(calc('SUM(DELTA({1;2;1},1))')).toBe(2);
    expect(calc('SUM(IMABS({"3+4i";"5"}))')).toBe(10);
  });

  it('keep the range readers whole', () => {
    expect(calc('NPV(0.1,{100;200})')).toBeCloseTo(100 / 1.1 + 200 / 1.21, 9);
    expect(calc('IMSUM({"1+i";"2"})')).toBe('3+i');
    expect(calc('IMPRODUCT({"1+i";"1-i"})')).toBe('2');
    expect(calc('ROWS(MMULT({1,2;3,4},{1;1}))')).toBe(2);
    expect(calc('IRR({-100;60;60})')).toBeCloseTo(0.1307, 4);
  });
});
