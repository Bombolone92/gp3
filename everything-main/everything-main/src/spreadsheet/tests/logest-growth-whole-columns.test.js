import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

// LINEST and TREND pair two whole columns on different sheets by their addresses, reading the
// shorter sheet's column on with blanks. LOGEST and GROWTH fit the same line through ln(y), but
// took the logarithms into a fresh array with no address, so the fit saw one reference instead of
// two, could not pad, and answered #REF!.

const SHEET = { A1: 1, A2: 2, A3: 4 };
const DATA = { A1: 3, A2: 4, A3: 5, A4: 6, A5: 7 };

function fill(wb, id, cells) {
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, String(text));
  }
}

function two(formula, cells = 1) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  fill(wb, wb.addSheet('Data').id, DATA);
  fill(wb, id, SHEET);
  wb.setInput(id, 0, 10, `=${formula}`);
  const out = [];
  for (let c = 0; c < cells; c++) out.push(wb.getValue(id, 0, 10 + c));
  return cells === 1 ? out[0] : out;
}

describe('LOGEST and GROWTH over whole columns of two sheets', () => {
  it('fit the curve through the rows both hold', () => {
    // y = 1, 2, 4 against x = 3, 4, 5: ln y rises by ln 2 per step, so the base is 2 and
    // y = 2^(x-3), which is 64 at x = 9.
    const [base, b] = two('LOGEST(A:A,Data!A:A)', 2);
    expect(base).toBeCloseTo(2, 12);
    expect(b).toBeCloseTo(0.125, 12);
    expect(two('GROWTH(A:A,Data!A:A,{9})')).toBeCloseTo(64, 9);
  });

  it('answer as the same bounded ranges do', () => {
    expect(two('LOGEST(A:A,Data!A:A)')).toBe(two('LOGEST(A1:A3,Data!A1:A3)'));
    expect(two('GROWTH(A:A,Data!A:A,{9})')).toBe(two('GROWTH(A1:A3,Data!A1:A3,{9})'));
    expect(two('LOGEST(A:A,Data!A:A)')).toBe(two('LOGEST(A1:A10,Data!A1:A10)'));
  });

  it('leave the single-column, same-sheet and bounded-mismatch cases as they were', () => {
    expect(two('LOGEST(A1:A3)')).toBeCloseTo(2, 12);
    expect(two('GROWTH(A1:A3)', 1)).toBeCloseTo(1, 12);
    expect(two('LOGEST(A1:A3,{3;4;5})')).toBeCloseTo(2, 12);
    expect(two('LOGEST(A1:A3,Data!A1:A5)')).toEqual({ error: '#REF!' });
    expect(two('LOGEST(A1:A3,{3;4;5;6;7})')).toEqual({ error: '#REF!' });
    // A y that is not positive has no logarithm, whatever the shape of the fit.
    expect(two('LOGEST({1;0;4},Data!A1:A3)')).toEqual({ error: '#NUM!' });
  });
});
