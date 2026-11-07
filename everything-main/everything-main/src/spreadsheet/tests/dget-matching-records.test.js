import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function calc(formula, cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 20, 0, `=${formula}`);
  return wb.getValue(id, 20, 0);
}

const DB = {
  A1: 'Region', B1: 'Sales',
  A2: 'West', B2: '',
  A3: 'West', B3: '5',
  A4: 'East', B4: '7',
  A5: 'North', B5: '',
  D1: 'Region', D2: 'West',
  F1: 'Region', F2: 'East',
  H1: 'Region', H2: 'South',
  J1: 'Region', J2: 'North',
};

// DGET counts the records that match: more than one is #NUM!, none is #VALUE!, whatever the field holds.
describe('DGET and the number of matching records', () => {
  it('is #NUM! when two records match even if only one has a value in the field', () => {
    expect(calc('DGET(A1:B5,"Sales",D1:D2)', DB)).toEqual({ error: '#NUM!' });
  });

  it('returns the single matching record\'s value, blank included', () => {
    expect(calc('DGET(A1:B5,"Sales",F1:F2)', DB)).toBe(7);
    expect(calc('LEN(DGET(A1:B5,"Sales",J1:J2))', DB)).toBe(0);
    expect(calc('ISNUMBER(DGET(A1:B5,"Sales",J1:J2))', DB)).toBe(false);
  });

  it('is #VALUE! when no record matches', () => {
    expect(calc('DGET(A1:B5,"Sales",H1:H2)', DB)).toEqual({ error: '#VALUE!' });
  });
});
