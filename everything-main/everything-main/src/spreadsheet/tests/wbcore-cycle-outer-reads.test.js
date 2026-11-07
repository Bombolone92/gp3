import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

// A1 = IFNA(B1,0) over B1 = VLOOKUP(...)+A1 was 0 and #N/A when A1 was read first (B1's #N/A hid
// the provisional value of A1, so its answer stood with A1 read as blank, and once A1 had its value
// only B1 was judged again) and #CYCLE! in both cells when B1 was read first (IFNA passes the
// provisional #CYCLE! on). The grid paints A1 before B1, so the sheet showed 0 / #N/A until the
// status bar or a search read B1 first and both cells flipped. The outer cell of the circle is now
// judged too, with the circle's other cells read as blank: A1 takes its 0 from B1, so the pair is a
// cycle whichever cell is read first.

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
const formulas = (cells) => Object.keys(cells).filter((k) => cells[k].startsWith('='));

describe('a circle whose reader hides the provisional value behind another error', () => {
  it.each([
    ['IFNA over a VLOOKUP miss', { D1: 'a', E1: '1', A1: '=IFNA(B1,0)', B1: '=VLOOKUP("zz",$D$1:$E$1,2,0)+A1' }],
    ['IF(ISNA()) over NA()', { A1: '=IF(ISNA(B1),"none",B1)', B1: '=NA()+A1' }],
    ['IFERROR over a division by zero', { A1: '=IFERROR(B1,0)', B1: '=1/0+A1' }],
    ['INDEX of a row that takes another cell', { D1: '7', A1: '=INDEX(B1:B1,1,1)+C2', B1: '=INDEX(A1:D1+1:1,1,4)', C2: '=B1*10' }],
    ['three cells, the error in the last', { A1: '=IFNA(B1,0)', B1: '=C1*2', C1: '=NA()+A1' }],
  ])('is a cycle whichever cell is read first: %s', (_, cells) => {
    for (const first of formulas(cells)) {
      const b = book(cells);
      expect(b.val(first), `${first} read first`).toEqual(CYCLE);
      for (const a1 of formulas(cells)) expect(b.val(a1), `${a1} after ${first}`).toEqual(CYCLE);
    }
  });

  it('gives the grid the same verdict when it paints the row left to right, and after an unrelated edit', () => {
    const b = book({ D1: 'a', E1: '1', A1: '=IFNA(B1,0)', B1: '=VLOOKUP("zz",$D$1:$E$1,2,0)+A1' });
    expect(b.wb.rangeValues(b.id, { r1: 0, c1: 0, r2: 0, c2: 1 })).toEqual([[CYCLE, CYCLE]]);
    b.set('F1', 'x');
    expect(b.val('B1')).toEqual(CYCLE);
    expect(b.val('A1')).toEqual(CYCLE);
    b.set('F2', 'y');
    expect(b.wb.rangeValues(b.id, { r1: 0, c1: 0, r2: 0, c2: 1 })).toEqual([[CYCLE, CYCLE]]);
  });

  it('recovers once the circle is broken, and re-forms it on undo', () => {
    const b = book({ A1: '=IFNA(B1,0)', B1: '=NA()+A1' });
    expect(b.val('A1')).toEqual(CYCLE);
    b.set('B1', '=NA()');
    expect(b.val('A1')).toBe(0);
    expect(b.val('B1')).toEqual({ error: '#N/A' });
    b.wb.undo();
    expect(b.val('B1')).toEqual(CYCLE);
    expect(b.val('A1')).toEqual(CYCLE);
  });
});

describe('a circle no cell of which takes a value from the other', () => {
  it('is accepted whichever cell is read first, and keeps what was read meanwhile', () => {
    // B1 takes D1 from its row whatever A1 holds; A1 answers 5 whatever B1 holds, an error included.
    const cells = { D1: '7', E5: '3', D5: '=E5*2', A1: '=IF(ISNUMBER(B1),5,5)+D5', B1: '=INDEX(A1:D1+1:1,1,4)' };
    for (const first of ['A1', 'B1', 'D5']) {
      const b = book(cells);
      b.val(first);
      expect(b.val('A1'), `${first} read first`).toBe(11);
      expect(b.val('B1'), `${first} read first`).toBe(14);
      expect(b.val('D5'), `${first} read first`).toBe(6);
    }
  });

  it('still accepts a cell that counts the rows of a range holding itself, and one that only asks whether it errs', () => {
    const b = book({ A1: '=ROWS(A1:A3)', A5: '=IF(ISERROR(A5),5,5)', B1: '=A1+1' });
    expect(b.val('A1')).toBe(3);
    expect(b.val('A5')).toBe(5);
    expect(b.val('B1')).toBe(4);
  });
});
