import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

const TABLE = { A1: '1', B1: 'one', A2: '2', B2: 'two' };

function calc(formula, cells = TABLE) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 9, 9, `=${formula}`);
  return wb.getValue(id, 9, 9);
}

const E = (code) => ({ error: code });

// An index below 1 is #VALUE!, one past the table is #REF!.
describe('VLOOKUP and HLOOKUP index bounds', () => {
  it('give #VALUE! for an index below 1', () => {
    expect(calc('VLOOKUP(2,A1:B2,0,FALSE)')).toEqual(E('#VALUE!'));
    expect(calc('VLOOKUP(2,A1:B2,-1,FALSE)')).toEqual(E('#VALUE!'));
    expect(calc('VLOOKUP(2,A1:B2,0.5,FALSE)')).toEqual(E('#VALUE!'));
    expect(calc('HLOOKUP(1,A1:B2,0,FALSE)')).toEqual(E('#VALUE!'));
    expect(calc('HLOOKUP(1,A1:B2,-2,FALSE)')).toEqual(E('#VALUE!'));
  });

  it('keep #REF! for an index past the table', () => {
    expect(calc('VLOOKUP(2,A1:B2,3,FALSE)')).toEqual(E('#REF!'));
    expect(calc('HLOOKUP(1,A1:B2,3,FALSE)')).toEqual(E('#REF!'));
  });

  it('still look up within bounds', () => {
    expect(calc('VLOOKUP(2,A1:B2,2,FALSE)')).toBe('two');
    expect(calc('HLOOKUP("one",A1:B2,2,FALSE)')).toBe('two');
  });
});
