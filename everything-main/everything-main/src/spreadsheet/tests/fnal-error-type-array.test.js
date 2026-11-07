import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

// ERROR.TYPE over a range or array answers one code per cell rather than 3
// (the code of #VALUE!) for the array as a whole, a wrong code that IF(ERROR.TYPE(rng)=7,...) acts on.

const NA = { error: '#N/A' };

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

describe('ERROR.TYPE over an array', () => {
  it('gives each cell its own code, #N/A for a value that is no error', () => {
    const errors = { A1: '#N/A', A2: '#DIV/0!', A3: 1 };
    expect(spill('ERROR.TYPE(A1:A3)', errors, 3)).toEqual([7, 2, NA]);
    expect(spill('ERROR.TYPE({1,2})', {}, 1, 2)).toEqual([NA, NA]);
    expect(spill('ERROR.TYPE(IF(A1:A3>1,NA(),1/0))', { A1: 1, A2: 2, A3: 3 }, 3)).toEqual([2, 7, 7]);
    expect(calc('SUM(IFERROR(ERROR.TYPE(A1:A3),0))', errors)).toBe(9);
    expect(calc('SUMPRODUCT(--(IFERROR(ERROR.TYPE(A1:A3),0)=7))', errors)).toBe(1);
  });

  it('answers a single value as before', () => {
    expect(calc('ERROR.TYPE(NA())')).toBe(7);
    expect(calc('ERROR.TYPE(1/0)')).toBe(2);
    expect(calc('ERROR.TYPE(A1)', { A1: '#REF!' })).toBe(4);
    expect(calc('ERROR.TYPE(1)')).toEqual(NA);
    expect(calc('ERROR.TYPE("x")')).toEqual(NA);
    expect(calc('ERROR.TYPE(A1)', { A1: '' })).toEqual(NA);
  });
});
