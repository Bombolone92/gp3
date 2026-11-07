import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

// A whole column is read only to its own sheet's used area, so A:A on a three-row sheet and Data!A:A on a
// five-row sheet arrive as three and five rows. Functions that pair two arrays cell by cell compare their
// addresses, as their dimensions are compared, and read the shorter one on to the longer with blanks,
// rather than refusing the pair as differently sized.

const VALUE = { error: '#VALUE!' };
const NA = { error: '#N/A' };
const SHEET = { A1: 1, A2: 2, A3: 4, B1: 10, B2: 0, B3: 1 };
const DATA = { A1: 3, A2: 4, A3: 5, A4: 6, A5: 7, B1: 20, B2: 1, B3: 1, B4: 1, B5: 1, C1: 30 };

function fill(wb, id, cells) {
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, String(text));
  }
}

/** The formula at K1 of a sheet beside a sheet named Data, with its spill read down or across. */
function two(formula, rows = 1, cols = 1) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  fill(wb, wb.addSheet('Data').id, DATA);
  fill(wb, id, SHEET);
  wb.setInput(id, 0, 10, `=${formula}`);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(wb.getValue(id, r, 10 + c));
  return rows === 1 && cols === 1 ? out[0] : out;
}

describe('SUMPRODUCT over whole columns of two sheets', () => {
  it('multiplies the rows both hold and takes the rest as blank', () => {
    expect(two('SUMPRODUCT(A:A,Data!A:A)')).toBe(31);
    expect(two('SUMPRODUCT(Data!A:A,A:A)')).toBe(31);
    expect(two('SUMPRODUCT(A:A,Data!A:A,Data!B:B)')).toBe(1 * 3 * 20 + 2 * 4 + 4 * 5);
    expect(two('SUMPRODUCT(3:3,Data!3:3)')).toBe(4 * 5 + 1 * 1);
    expect(two('SUMPRODUCT(A:A*Data!A:A)')).toBe(31);
  });

  it('keeps refusing arrays of different extents and pairing arrays without an address as read', () => {
    expect(two('SUMPRODUCT(A1:A3,Data!A1:A5)')).toEqual(VALUE);
    expect(two('SUMPRODUCT(A:A,Data!A:B)')).toEqual(VALUE);
    expect(two('SUMPRODUCT(A:A,Data!A1:A3)')).toEqual(VALUE);
    expect(two('SUMPRODUCT(A:A,--(B:B>0))')).toBe(5);
    expect(two('SUMPRODUCT(A:A,{1;2;3})')).toBe(17);
    expect(two('SUMPRODUCT(A1:A3,Data!A1:A3)')).toBe(31);
  });
});

describe('the paired statistics over whole columns of two sheets', () => {
  it('answer as the bounded pair does', () => {
    expect(two('CORREL(A:A,Data!A:A)')).toBeCloseTo(3 / Math.sqrt((14 / 3) * 2), 12);
    expect(two('PEARSON(A:A,Data!A:A)')).toBe(two('PEARSON(A1:A3,Data!A1:A3)'));
    expect(two('RSQ(A:A,Data!A:A)')).toBeCloseTo(27 / 28, 12);
    expect(two('SLOPE(Data!A:A,A:A)')).toBeCloseTo(9 / 14, 12);
    expect(two('INTERCEPT(Data!A:A,A:A)')).toBeCloseTo(2.5, 12);
    expect(two('FORECAST(5,Data!A:A,A:A)')).toBeCloseTo(40 / 7, 12);
    expect(two('STEYX(Data!A:A,A:A)')).toBeCloseTo(Math.sqrt(1 / 14), 12);
    expect(two('COVARIANCE.P(A:A,Data!A:A)')).toBeCloseTo(1, 12);
    expect(two('COVARIANCE.S(A:A,Data!A:A)')).toBeCloseTo(1.5, 12);
    expect(two('SUMXMY2(A:A,Data!A:A)')).toBe(9);
    expect(two('SUMX2MY2(A:A,Data!A:A)')).toBe(-29);
    expect(two('SUMX2PY2(A:A,Data!A:A)')).toBe(71);
    expect(two('T.TEST(A:A,Data!A:A,2,1)')).toBe(two('T.TEST(A1:A3,Data!A1:A3,2,1)'));
    expect(two('T.TEST(A:A,Data!A:A,2,1)')).toBeCloseTo(0.037749, 5);
    expect(two('CHISQ.TEST(A:A,Data!A:A)')).toBe(two('CHISQ.TEST(A1:A5,Data!A1:A5)'));
    expect(two('CHISQ.TEST(A:A,Data!A:A)')).toBeGreaterThan(0);
  });

  it('fit a line through the rows both hold', () => {
    const [slope, intercept] = two('LINEST(Data!A:A,A:A)', 1, 2);
    expect(slope).toBeCloseTo(9 / 14, 12);
    expect(intercept).toBeCloseTo(2.5, 12);
    expect(two('TREND(Data!A:A,A:A,{5})')).toBeCloseTo(40 / 7, 12);
    expect(two('TREND(Data!A:A,A:A,{5})')).toBe(two('TREND(Data!A1:A3,A1:A3,{5})'));
  });

  it('still refuse bounded pairs of different sizes', () => {
    expect(two('CORREL(A1:A3,Data!A1:A5)')).toEqual(NA);
    expect(two('SUMXMY2(A1:A3,Data!A1:A5)')).toEqual(NA);
    expect(two('T.TEST(A1:A3,Data!A1:A5,2,1)')).toEqual(NA);
    expect(two('CHISQ.TEST(A1:A3,Data!A1:A5)')).toEqual(NA);
    expect(two('LINEST(Data!A1:A5,A1:A3)')).toEqual({ error: '#REF!' });
  });
});
