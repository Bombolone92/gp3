import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function arr(formula, cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

const NUMBERS = { A1: 'x', B1: '5', A2: 'y', A3: 'z', B3: '6' };
const TEXTS = { A1: 'x', B1: 'p', A2: 'y', A3: 'z', B3: 'q' };

// In Sheets' QUERY every comparison with an empty cell is false; only "is null" and "is not null" see empties.
describe('QUERY comparisons with empty cells', () => {
  it('does not match an empty cell with <> or !=', () => {
    expect(arr('QUERY(A1:B3,"select A where B <> 5",0)', NUMBERS)).toEqual([['z']]);
    expect(arr('QUERY(A1:B3,"select A where B != 5",0)', NUMBERS)).toEqual([['z']]);
    expect(arr('QUERY(A1:B3,"select A where B <> \'p\'",0)', TEXTS)).toEqual([['z']]);
  });

  it('still finds empties through is null, or through not', () => {
    expect(arr('QUERY(A1:B3,"select A where B <> 5 or B is null",0)', NUMBERS)).toEqual([['y'], ['z']]);
    expect(arr('QUERY(A1:B3,"select A where B is null",0)', NUMBERS)).toEqual([['y']]);
    expect(arr('QUERY(A1:B3,"select A where not B = 5",0)', NUMBERS)).toEqual([['y'], ['z']]);
  });

  it('keeps the other comparisons false for empties', () => {
    expect(arr('QUERY(A1:B3,"select A where B = 5",0)', NUMBERS)).toEqual([['x']]);
    expect(arr('QUERY(A1:B3,"select A where B < 6",0)', NUMBERS)).toEqual([['x']]);
    expect(arr('QUERY(A1:B3,"select A where B >= 5",0)', NUMBERS)).toEqual([['x'], ['z']]);
  });
});
