import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function calc(formula, cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, text);
  }
  wb.setInput(id, 99, 25, `=${formula}`);
  return wb.getValue(id, 99, 25);
}

// AGGREGATE options 0-3 ignore nested SUBTOTAL and AGGREGATE functions; 4-7 ignore nothing of the kind.
const CELLS = { Y1: '1', Y2: '2', Y3: '=SUBTOTAL(9,Y1:Y2)', Y4: '=AGGREGATE(9,4,Y1:Y2)' };

describe('AGGREGATE and nested subtotals', () => {
  it.each([0, 1, 2, 3])('option %i leaves out cells holding SUBTOTAL or AGGREGATE', (option) => {
    expect(calc(`AGGREGATE(9,${option},Y1:Y4)`, CELLS)).toBe(3);
    expect(calc(`AGGREGATE(3,${option},Y1:Y4)`, CELLS)).toBe(2);
    expect(calc(`AGGREGATE(14,${option},Y1:Y4,1)`, CELLS)).toBe(2);
  });

  it.each([4, 5, 6, 7])('option %i counts nested subtotals like any other cell', (option) => {
    expect(calc(`AGGREGATE(9,${option},Y1:Y4)`, CELLS)).toBe(9);
    expect(calc(`AGGREGATE(14,${option},Y1:Y4,1)`, CELLS)).toBe(3);
  });

  it('still skips errors and honours the reference shape when leaving out nested subtotals', () => {
    const cells = { ...CELLS, Y5: '=1/0' };
    expect(calc('AGGREGATE(9,2,Y1:Y5)', cells)).toBe(3);
    expect(calc('AGGREGATE(9,0,Y1:Y5)', cells)).toEqual({ error: '#DIV/0!' });
    expect(calc('AGGREGATE(9,0,Y1:Y2,Y3:Y4)', CELLS)).toBe(3);
  });
});
