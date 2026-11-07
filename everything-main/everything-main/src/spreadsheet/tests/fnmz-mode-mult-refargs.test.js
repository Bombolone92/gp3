import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

// A text cell referenced on its own is skipped by MODE.MULT as one inside a range is, and as MODE,
// STDEVA and the other statistics skip it, rather than being coerced to #VALUE!.

const CELLS = { A1: 'x', A2: 2, A3: 2, B1: 'TRUE' };

function spill(formula, rows, cells = CELLS) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, String(text));
  }
  wb.setInput(id, 0, 10, `=${formula}`);
  return Array.from({ length: rows }, (_, r) => wb.getValue(id, r, 10));
}

describe('MODE.MULT with single-cell references', () => {
  it('passes over a referenced text or boolean cell, as MODE does', () => {
    expect(calc('MODE.MULT(A1,A2,A3)', CELLS)).toBe(2);
    expect(calc('MODE.MULT(A1,A2,A3,B1)', CELLS)).toBe(2);
    expect(calc('MODE.MULT(A1:A3)', CELLS)).toBe(2);
    expect(calc('MODE(A1,A2,A3)', CELLS)).toBe(2);
  });

  it('still coerces values written into the formula and lists every mode', () => {
    expect(calc('MODE.MULT("x",2,2)')).toEqual({ error: '#VALUE!' });
    expect(calc('MODE.MULT("2",2,3)')).toBe(2);
    expect(calc('MODE.MULT(1,2,3)')).toEqual({ error: '#N/A' });
    expect(spill('MODE.MULT({1,2,2,3,3})', 3)).toEqual([2, 3, null]);
    expect(spill('MODE.MULT(A1:A3,B1:B3)', 3, { A1: 1, A2: 1, A3: 2, B1: 2, B2: 3, B3: 'x' })).toEqual([1, 2, null]);
  });
});
