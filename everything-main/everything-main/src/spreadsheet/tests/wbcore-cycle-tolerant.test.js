import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function book(cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const at = (a1) => parseCellRef(a1);
  const api = {
    wb, id,
    set: (a1, text) => { const { r, c } = at(a1); wb.setInput(id, r, c, text); },
    val: (a1) => { const { r, c } = at(a1); return wb.getValue(id, r, c); },
  };
  for (const [a1, text] of Object.entries(cells)) api.set(a1, text);
  return api;
}

const CYCLE = { error: '#CYCLE!' };

describe('a circle of references through an error-tolerant formula', () => {
  it('is a cycle for a count of the column that holds the count', () => {
    const b = book({ A2: '1', A3: '2', A4: '3', A5: '4', A1: '=COUNTA(A:A)', J1: '=COUNTA(J:J)+0', I1: '=ISERROR(I1)' });
    expect(b.val('A1')).toEqual(CYCLE);
    expect(b.val('J1')).toEqual(CYCLE);
    expect(b.val('I1')).toEqual(CYCLE);
    // A count of another column is untouched, and so is an error that is not a cycle.
    b.set('B1', '=COUNTA(A2:A5)');
    b.set('B2', '=IFERROR(1/0, 5)');
    expect(b.val('B1')).toBe(4);
    expect(b.val('B2')).toBe(5);
  });

  it('marks every cell on the circle whichever is read first', () => {
    for (const first of ['A1', 'B1']) {
      const b = book({ A1: '=B1+1', B1: '=IFERROR(A1, 0)' });
      expect(b.val(first)).toEqual(CYCLE);
      expect(b.val('A1')).toEqual(CYCLE);
      expect(b.val('B1')).toEqual(CYCLE);
    }
  });

  it('is no cycle when the provisional value never told in the answer', () => {
    const b = book({ A1: '1', B1: '2' });
    b.set('D1', '=INDEX(A1:F1+1:1,1,5)'); // its own row is read, another cell of it taken
    expect(b.val('D1')).toBe(0);
    b.set('D1', '=COLUMNS(A1:F1*1:1)');
    expect(b.val('D1')).toBe(6);
    b.set('D1', '=INDEX(A1:F1+1:1,1,4)'); // its own cell taken: a cycle after all
    expect(b.val('D1')).toEqual(CYCLE);
    const other = book();
    other.wb.addSheet('Other');
    other.set('A1', '=SUM(Other!A1:INDEX(A1:A3,2))'); // fails for another reason, the same way
    expect(other.val('A1')).toEqual({ error: '#VALUE!' });
  });

  it('leaves cells outside the circle with their own values', () => {
    const b = book({ A1: '=B1+1', B1: '=IFERROR(A1, 0)', C1: '=IFERROR(A1, 7)', D1: '=COUNT(A1:B1)' });
    expect(b.val('C1')).toBe(7);
    expect(b.val('D1')).toBe(0);
    expect(b.val('A1')).toEqual(CYCLE);
    // Breaking the circle recalculates everything on it.
    b.set('B1', '3');
    expect(b.val('A1')).toBe(4);
    expect(b.val('C1')).toBe(4);
  });
});
