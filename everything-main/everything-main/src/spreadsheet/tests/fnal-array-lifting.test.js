import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

// A single-value function is lifted over an array where it expects one value: LARGE over its k,
// RANK over the value ranked, NORM.S.DIST over z, NETWORKDAYS over its dates. Each answers one value
// per element and spills, and SUM(LARGE(A1:A5,{1,2,3})) adds the top three.

const VALUE = { error: '#VALUE!' };
const NUM = { error: '#NUM!' };
const NA = { error: '#N/A' };
const A5 = { A1: 5, A2: 3, A3: 9, A4: 1, A5: 7 };

/** The formula at K1 with its spill, read as rows × cols values in row order. */
function spill(formula, cells = {}, rows = 1, cols = 1) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, String(text));
  }
  wb.setInput(id, 0, 10, `=${formula}`);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(wb.getValue(id, r, 10 + c));
  return out;
}

describe('LARGE, SMALL, PERCENTILE, QUARTILE and TRIMMEAN over an array of k', () => {
  it('answer one value per element and spill', () => {
    expect(calc('SUM(LARGE(A1:A5,{1,2,3}))', A5)).toBe(21);
    expect(spill('LARGE(A1:A5,{1;2;3})', A5, 3)).toEqual([9, 7, 5]);
    expect(spill('LARGE(A1:A5,ROW(1:3))', A5, 3)).toEqual([9, 7, 5]);
    expect(spill('SMALL(A1:A5,{1,2})', A5, 1, 2)).toEqual([1, 3]);
    expect(spill('LARGE(A1:A5,B1:B2)', { ...A5, B1: 1, B2: 5 }, 2)).toEqual([9, 1]);
    expect(spill('PERCENTILE(A1:A5,{0.25;0.5;0.75})', A5, 3)).toEqual([3, 5, 7]);
    expect(spill('PERCENTILE.INC(A1:A5,{0.25;0.5;0.75})', A5, 3)).toEqual([3, 5, 7]);
    expect(spill('QUARTILE(A1:A5,{1,2,3})', A5, 1, 3)).toEqual([3, 5, 7]);
    expect(spill('PERCENTILE.EXC(A1:A5,{0.25;0.5})', A5, 2)).toEqual([2, 5]);
    expect(spill('QUARTILE.EXC(A1:A5,{1,3})', A5, 1, 2)).toEqual([2, 8]);
    expect(spill('TRIMMEAN(A1:A5,{0;0.4})', { A1: 1, A2: 2, A3: 3, A4: 4, A5: 100 }, 2)).toEqual([22, 3]);
  });

  it('keep an element out of range as its own #NUM! and a scalar call as it was', () => {
    expect(spill('LARGE(A1:A5,{0,1,6})', A5, 1, 3)).toEqual([NUM, 9, NUM]);
    expect(calc('LARGE(A1:A5,2)', A5)).toBe(7);
    expect(calc('SMALL(A1:A5,2)', A5)).toBe(3);
    expect(calc('LARGE(A1:A5,"x")', A5)).toEqual(VALUE);
    expect(calc('PERCENTILE(A1:A5,0.5)', A5)).toBe(5);
    expect(calc('QUARTILE(A1:A5,-0.5)', A5)).toEqual(NUM);
    expect(calc('TRIMMEAN(A1:A5,0.4)', A5)).toBe(5);
  });
});

describe('RANK, RANK.AVG and PERCENTRANK over an array of values', () => {
  it('rank a whole column against itself, as the idiom goes', () => {
    expect(spill('RANK(A1:A5,A1:A5)', A5, 5)).toEqual([3, 4, 1, 5, 2]);
    expect(spill('RANK.EQ(A1:A5,A1:A5,1)', A5, 5)).toEqual([3, 2, 5, 1, 4]);
    expect(spill('RANK.AVG(A1:A3,A1:A3)', { A1: 2, A2: 2, A3: 3 }, 3)).toEqual([2.5, 2.5, 1]);
    expect(spill('RANK({5;99},A1:A5)', A5, 2)).toEqual([3, NA]);
    expect(spill('PERCENTRANK(A1:A5,A1:A5)', A5, 5)).toEqual([0.5, 0.25, 1, 0, 0.75]);
    expect(spill('PERCENTRANK.EXC(A1:A5,{3;5})', A5, 2)).toEqual([0.333, 0.5]);
    expect(spill('PERCENTRANK(A1:A5,{4;10})', A5, 2)).toEqual([0.375, NA]);
  });

  it('keep scalar answers and rank only exact numeric ties', () => {
    expect(calc('RANK(5,A1:A5)', A5)).toBe(3);
    expect(calc('RANK(5,A1:A5,1)', A5)).toBe(3);
    expect(calc('RANK(4,A1:A5)', A5)).toEqual(NA);
    expect(calc('RANK.AVG(2,{2,2,3})')).toBe(2.5);
    expect(calc('RANK.AVG(3,{2,2,3},1)')).toBe(3);
    expect(calc('RANK(3.3,{1.1*3,2,4})')).toEqual(NA); // ranking distinguishes the stored numbers, unlike =
    expect(calc('PERCENTRANK(A1:A5,4)', A5)).toBe(0.375);
    expect(calc('PERCENTRANK.EXC(A1:A5,3)', A5)).toBe(0.333);
  });

  it('sort the column once for all its cells', { timeout: 60000 }, () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const n = 20000;
    for (let r = 0; r < n; r++) wb.setInput(id, r, 0, String((r * 7919) % 10007));
    const t = performance.now();
    wb.setInput(id, 0, 2, `=RANK(A1:A${n},A1:A${n})`);
    expect(wb.getValue(id, 0, 2)).toBe(1 + [...Array(n)].filter((_, r) => ((r * 7919) % 10007) > 0).length);
    expect(wb.getValue(id, n - 1, 2)).toBeGreaterThan(0);
    // A sort per cell, 20,000 sorts of 20,000 numbers, takes seconds; one sort and a binary search per cell takes milliseconds.
    expect(performance.now() - t).toBeLessThan(1500);
  });
});

describe('single-value functions over a range', () => {
  it('spill one answer per cell, as LEN and ROUND already do', () => {
    const [a, b] = spill('NORM.S.DIST({0;1},TRUE)', {}, 2);
    expect(a).toBe(0.5);
    expect(b).toBeCloseTo(0.841344746, 9);
    expect(calc('SUMPRODUCT(NORM.S.DIST(A1:A3,TRUE))', { A1: 0, A2: 0, A3: 0 })).toBe(1.5);
    expect(spill('NORM.DIST(A1:A2,0,1,FALSE)', { A1: 0, A2: 0 }, 2).map((v) => Number(v.toFixed(6)))).toEqual([0.398942, 0.398942]);
    expect(spill('COMBIN(5,{1,2})', {}, 1, 2)).toEqual([5, 10]);
    expect(spill('PERMUT({3;4},2)', {}, 2)).toEqual([6, 12]);
    expect(spill('GAMMA({5;6})', {}, 2)).toEqual([24, 120]);
    expect(spill('FIXED({1234.5;2},1)', {}, 2)).toEqual(['1,234.5', '2.0']);
    expect(spill('DOLLAR({1;2})', {}, 2)).toEqual(['$1.00', '$2.00']);
    expect(spill('ROMAN({1,4})', {}, 1, 2)).toEqual(['I', 'IV']);
    expect(spill('ARABIC({"I";"IV"})', {}, 2)).toEqual([1, 4]);
    expect(spill('BASE({2;3},2)', {}, 2)).toEqual(['10', '11']);
    expect(spill('DECIMAL({"10";"11"},2)', {}, 2)).toEqual([2, 3]);
    expect(spill('ENCODEURL({"a b";"c"})', {}, 2)).toEqual(['a%20b', 'c']);
    expect(spill('REGEXMATCH({"a1";"b"},"\\d")', {}, 2)).toEqual([true, false]);
    expect(spill('REGEXTEST({"a1";"b"},"\\d")', {}, 2)).toEqual([true, false]);
    expect(spill('REGEXREPLACE({"a1";"b2"},"\\d","")', {}, 2)).toEqual(['a', 'b']);
    expect(spill('STANDARDIZE({1;2},1,1)', {}, 2)).toEqual([0, 1]);
    expect(spill('YEARFRAC(A1:A2,B1:B2)', { A1: 45292, A2: 45292, B1: 45658, B2: 45474 }, 2)).toEqual([1, 0.5]);
    expect(spill('DAYS360(A1:A2,B1:B2)', { A1: 45292, A2: 45292, B1: 45658, B2: 45323 }, 2)).toEqual([360, 30]);
    expect(spill('BINOM.DIST({0;1},1,0.5,FALSE)', {}, 2)).toEqual([0.5, 0.5]);
    expect(spill('ERF({0;10})', {}, 2)).toEqual([0, 1]);
    expect(spill('TEXTBEFORE({"a-b";"c-d"},"-")', {}, 2)).toEqual(['a', 'c']);
    expect(spill('TEXTAFTER(A1:A2,"-")', { A1: 'a-b', A2: 'c-d' }, 2)).toEqual(['b', 'd']);
    expect(spill('RANDBETWEEN({1;2},{1;2})', {}, 2)).toEqual([1, 2]);
  });

  it('leave an array delimiter, a holidays range and a weekend string whole', () => {
    // 2024-01-01 (45292) is a Monday: two working days to Wednesday, three to Thursday.
    const dates = { A1: 45292, A2: 45292, B1: 45294, B2: 45295, C1: 45293 };
    expect(spill('NETWORKDAYS(A1:A2,B1:B2)', dates, 2)).toEqual([3, 4]);
    expect(spill('NETWORKDAYS(A1:A2,B1:B2,C1)', dates, 2)).toEqual([2, 3]);
    expect(spill('NETWORKDAYS.INTL(A1:A2,B1:B2,"0000011",C1:C1)', dates, 2)).toEqual([2, 3]);
    expect(spill('WORKDAY(A1,{1;5})', dates, 2)).toEqual([45293, 45299]);
    expect(spill('WORKDAY.INTL(A1,{1;5},1)', dates, 2)).toEqual([45293, 45299]);
    expect(calc('NETWORKDAYS(A1,B2,C1:C2)', { ...dates, C2: 45294 })).toBe(2);
    expect(calc('TEXTBEFORE("a-b;c",{"-",";"})')).toBe('a');
    expect(calc('TEXTAFTER("a-b;c",{"-",";"},2)')).toBe('c');
  });
});

describe('ISBETWEEN, ISEMAIL and ISURL over an array', () => {
  it('judge each cell rather than answering FALSE for the array', () => {
    expect(spill('ISBETWEEN(A1:A3,1,2)', { A1: 1, A2: 5, A3: 2 }, 3)).toEqual([true, false, true]);
    expect(spill('ISBETWEEN(2,{1,3},3)', {}, 1, 2)).toEqual([true, false]);
    expect(spill('ISEMAIL({"a@b.com","x"})', {}, 1, 2)).toEqual([true, false]);
    expect(spill('ISEMAIL(A1:A2)', { A1: 'a@b.com', A2: 'x' }, 2)).toEqual([true, false]);
    expect(spill('ISURL({"http://a.com","x"})', {}, 1, 2)).toEqual([true, false]);
    expect(calc('SUMPRODUCT(--ISEMAIL(A1:A3))', { A1: 'a@b.com', A2: 'x', A3: 'c@d.org' })).toBe(2);
    expect(calc('ISEMAIL("a@b.com")')).toBe(true);
    expect(calc('ISURL("http://a.com")')).toBe(true);
    expect(calc('ISBETWEEN(2,1,3)')).toBe(true);
    expect(calc('ISBETWEEN(3,1,3,TRUE,FALSE)')).toBe(false);
  });
});
