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

describe('a circle of references whose reader swallowed the provisional value', () => {
  it.each([
    ['COUNT', '=COUNT(A1)'],
    ['IF(ISNUMBER())', '=IF(ISNUMBER(A1),A1*2,0)'],
  ])('is a cycle whichever cell is read first when the other cell ends with a number (%s)', (_, reader) => {
    for (const first of ['A1', 'B1']) {
      const b = book({ A1: '=B1+1', B1: reader });
      expect(b.val(first)).toEqual(CYCLE);
      expect(b.val('A1')).toEqual(CYCLE);
      expect(b.val('B1')).toEqual(CYCLE);
    }
  });

  it('marks a three-cell circle read from its middle', () => {
    const b = book({ A1: '=C1+1', B1: '=A1*2', C1: '=COUNT(B1)' });
    expect(b.val('B1')).toEqual(CYCLE);
    expect(b.val('A1')).toEqual(CYCLE);
    expect(b.val('C1')).toEqual(CYCLE);
  });

  it('gives the grid the same verdict when it paints a row left to right', () => {
    const b = book({ A1: '=B1+1', B1: '=COUNT(A1)' });
    expect(b.wb.rangeValues(b.id, { r1: 0, c1: 0, r2: 0, c2: 1 })).toEqual([[CYCLE, CYCLE]]);
  });

  it('keeps the verdict across an unrelated edit, whichever cell is read first afterwards', () => {
    const b = book({ A1: '=B1+1', B1: '=COUNT(A1)' });
    expect(b.val('A1')).toEqual(CYCLE);
    b.set('F1', 'x');
    expect(b.val('B1')).toEqual(CYCLE);
    expect(b.val('A1')).toEqual(CYCLE);
    b.set('F2', 'y');
    expect(b.val('A1')).toEqual(CYCLE);
    expect(b.val('B1')).toEqual(CYCLE);
  });

  it('recalculates a cell outside the circle that read the swallowed value', () => {
    const b = book({ A1: '=B1+C1', B1: '=COUNT(A1)', C1: '=B1*10' });
    expect(b.val('A1')).toEqual(CYCLE);
    expect(b.val('B1')).toEqual(CYCLE);
    expect(b.val('C1')).toEqual(CYCLE);
  });

  it('works across sheets', () => {
    const b = book({ A1: '=Other!A1+1' });
    const other = b.wb.addSheet('Other').id;
    b.wb.setInput(other, 0, 0, '=COUNT(Sheet1!A1)');
    expect(b.val('A1')).toEqual(CYCLE);
    expect(b.wb.getValue(other, 0, 0)).toEqual(CYCLE);
  });

  it('still accepts a circle whose provisional value never told, and keeps what was read meanwhile', () => {
    // B1 takes D1 from its row whatever A1 holds and A1 answers 5 whatever B1 holds, so the pair is
    // no cycle in either order; D5, calculated while the circle was unsettled, keeps its answer.
    for (const first of ['A1', 'B1']) {
      const b = book({ D1: '7', E5: '3', D5: '=E5*2', A1: '=IF(ISNUMBER(B1),5,5)+D5', B1: '=INDEX(A1:D1+1:1,1,4)' });
      expect(b.val(first)).toBe(first === 'A1' ? 11 : 14);
      expect(b.val('A1')).toBe(11);
      expect(b.val('B1')).toBe(14);
      expect(b.val('D5')).toBe(6);
    }
  });

  it('marks a circle whose outer cell reads the value of a reader that never told, in either order', () => {
    // B1 takes D1 from its row whatever A1 says, but A1 takes B1's value: read from B1 or C2 the
    // pair was a cycle at once, and read from A1 it must be the same.
    for (const first of ['A1', 'B1', 'C2']) {
      const b = book({ D1: '7', A1: '=INDEX(B1:B1,1,1)+C2', B1: '=INDEX(A1:D1+1:1,1,4)', C2: '=B1*10' });
      expect(b.val(first)).toEqual(CYCLE);
      expect(b.val('A1')).toEqual(CYCLE);
      expect(b.val('B1')).toEqual(CYCLE);
      expect(b.val('C2')).toEqual(CYCLE);
    }
  });
});
