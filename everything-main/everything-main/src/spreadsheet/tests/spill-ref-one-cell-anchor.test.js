import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

// =A1# is itself an array formula and has a spill range of its own. A one-cell spill range is read
// as a plain cell reference, so the copy's value was a scalar rather than a range of one cell and
// its own anchor was dropped: a dashboard that copies a FILTER and then totals the copy answered
// #REF! the moment the FILTER narrowed to one row, one link further along than before.

const REF = { error: '#REF!' };

function book(sheets = 1) {
  const wb = new Workbook();
  while (wb.sheets.length < sheets) wb.addSheet();
  const at = (a1) => parseCellRef(a1);
  const on = (n) => wb.sheets[n].id;
  return {
    wb,
    set: (a1, text, n = 0) => { const { r, c } = at(a1); wb.setInput(on(n), r, c, text); },
    val: (a1, n = 0) => { const { r, c } = at(a1); return wb.getValue(on(n), r, c); },
    range: (a1, n = 0) => { const { r, c } = at(a1); return wb.spillRangeAt(on(n), r, c); },
    id: on,
  };
}

describe('=A1# when the array formula it copies narrows to one cell', () => {
  it('keeps a spill range of its own, so the next link still holds', () => {
    const b = book();
    b.set('G1', '3');
    b.set('A1', '=FILTER(SEQUENCE(3),SEQUENCE(3)<=G1)');
    b.set('C1', '=A1#');
    b.set('E1', '=SUM(C1#)');
    b.set('E2', '=ROWS(C1#)');
    expect(b.val('E1')).toBe(6);
    expect(b.val('E2')).toBe(3);
    expect(b.range('C1')).toEqual({ r1: 0, c1: 2, r2: 2, c2: 2 });

    b.set('G1', '1');
    expect(b.val('A1')).toBe(1);
    expect(b.val('C1')).toBe(1);
    expect(b.val('E1')).toBe(1);
    expect(b.val('E2')).toBe(1);
    expect(b.range('C1')).toEqual({ r1: 0, c1: 2, r2: 0, c2: 2 });
    // The one cell covers no neighbour, so nothing below it is blocked or painted.
    expect(b.wb.spillAt(b.id(0), 1, 2)).toBeNull();
    expect(b.val('C2')).toBeNull();

    b.set('G1', '3');
    expect(b.val('E1')).toBe(6);
    expect(b.val('E2')).toBe(3);
    b.wb.undo();
    expect(b.val('E1')).toBe(1);
    b.wb.redo();
    expect(b.val('E1')).toBe(6);
  });

  it('holds across sheets and one link further along', () => {
    const b = book(2);
    b.set('G1', '1');
    b.set('A1', '=FILTER(SEQUENCE(3),SEQUENCE(3)<=G1)');
    b.set('A1', '=Sheet1!A1#', 1);
    b.set('C1', '=A1#', 1);
    b.set('E1', '=SUM(C1#)', 1);
    b.set('E2', '=COUNTA(A1#)', 1);
    expect(b.val('A1', 1)).toBe(1);
    expect(b.val('E1', 1)).toBe(1);
    expect(b.val('E2', 1)).toBe(1);
    b.set('G1', '3');
    expect(b.val('E1', 1)).toBe(6);
    expect(b.val('E2', 1)).toBe(3);
  });

  it('carries an expression over the copy, treating =A1#*2 as an array formula too', () => {
    const b = book();
    b.set('A5', '4');
    b.set('A1', '=FILTER(A5:A5,A5:A5>0)');
    b.set('C1', '=A1#*2');
    b.set('E1', '=SUM(C1#)');
    expect(b.val('C1')).toBe(8);
    expect(b.val('E1')).toBe(8);
    expect(b.range('C1')).toEqual({ r1: 0, c1: 2, r2: 0, c2: 2 });
  });

  it('still drops the spill range when the array formula answers an error', () => {
    const b = book();
    b.set('A5', '1'); b.set('A6', '2');
    b.set('A1', '=FILTER(A5:A6,A5:A6>10)');
    b.set('C1', '=SUM(A1#)');
    expect(b.val('A1')).toEqual({ error: '#CALC!' });
    expect(b.val('C1')).toEqual(REF);
    expect(b.range('A1')).toBeNull();

    const blocked = book();
    blocked.set('A2', 'x');
    blocked.set('A1', '=SEQUENCE(3)');
    blocked.set('C1', '=SUM(A1#)');
    expect(blocked.val('A1')).toEqual({ error: '#SPILL!' });
    expect(blocked.val('C1')).toEqual(REF);
    expect(blocked.range('A1')).toBeNull();
  });

  it('leaves the @ operator alone, which is the opposite of an array formula', () => {
    // @A1:A3 takes the one value on the formula's own row, so it has no spill range of its own and
    // is written to .xlsx as a plain formula, not as a one-cell array formula.
    const b = book();
    b.set('A1', '1'); b.set('A2', '2'); b.set('A3', '3');
    b.set('C2', '=@A1:A3*10');
    b.set('D2', '=SUM(C2#)');
    expect(b.val('C2')).toBe(20);
    expect(b.val('D2')).toEqual(REF);
    expect(b.range('C2')).toBeNull();
  });

  it('leaves a LAMBDA with an optional parameter alone', () => {
    // [b] declares a parameter that may be left out; it was not read as a parameter name at all, so
    // the whole formula was judged able to spill and, answering one value, took a spill range of
    // its own — which .xlsx then wrote as a one-cell array formula.
    const b = book();
    b.set('C1', '=LAMBDA(a,[b],IF(ISOMITTED(b),a,a+b))(1)');
    b.set('C2', '=LAMBDA(a,[b],IF(ISOMITTED(b),a,a+b))(1,2)');
    b.set('C3', '=LAMBDA(x,x*2)(4)');
    expect(b.val('C1')).toBe(1);
    expect(b.val('C2')).toBe(3);
    expect(b.val('C3')).toBe(8);
    for (const a1 of ['C1', 'C2', 'C3']) expect(b.range(a1)).toBeNull();
    // One whose body really does spill still does.
    b.set('C5', '=LAMBDA([n],SEQUENCE(IF(ISOMITTED(n),3,n)))()');
    expect(b.val('C5')).toBe(1);
    expect(b.range('C5')).toEqual({ r1: 4, c1: 2, r2: 6, c2: 2 });
  });

  it('still answers #REF! for a formula that is no array formula', () => {
    const b = book();
    b.set('A10', '5');
    b.set('A1', '=5');
    b.set('A2', '=A10');
    b.set('A3', '=INDEX($A:$A,ROW())');
    b.set('A4', '=A10*2');
    b.wb.defineName('Tax', 'Sheet1!$A$10');
    b.set('A5', '=Tax');
    for (const [k, a1] of ['A1', 'A2', 'A3', 'A4', 'A5'].entries()) {
      b.set(`C${k + 1}`, `=SUM(${a1}#)`);
      expect(b.val(`C${k + 1}`)).toEqual(REF);
      expect(b.range(a1)).toBeNull();
    }
  });
});
