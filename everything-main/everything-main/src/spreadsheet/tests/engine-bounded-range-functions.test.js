import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A bounded reference is read only a fixed distance (1,000 rows) past its data, while the arrays
// computed from it have its full shape. A function taking both, or sizing its answer by the
// reference, must see every cell the reference names, or the two disagree.
describe('functions over a bounded range read past its data', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (const [r, a, b] of [[0, 'x', '1'], [1, 'y', '2'], [2, 'x', '4']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
    return { wb, id };
  };
  const at = (wb, id, f) => { wb.setInput(id, 50, 40, f); return wb.getValue(id, 50, 40); };

  it.each([
    ['=FILTER(A1:A5000,B1:B5000>1)', 'y'],
    ['=ROWS(FILTER(A1:A5000,B1:B5000>1))', 2],
    ['=SUMPRODUCT(--(A1:A5000="x"),B1:B5000)', 5],
    ['=SUMPRODUCT(LEN(A1:A5000),B1:B5000)', 7],
    ['=SUMPRODUCT(IF(A1:A5000="x",1,0),B1:B5000)', 5],
    ['=SUMPRODUCT(B1:B5000,ROW(B1:B5000))', 17],
    ['=INDEX(SORTBY(A1:A2000,-B1:B2000),2)', 'y'],
    ['=ROWS(DROP(A1:A5000,4999))', 1],
    ['=ROWS(SORT(A1:A5000))', 5000],
    ['=ROWS(TOCOL(A1:A5000))', 5000],
    ['=COLUMNS(TRANSPOSE(A1:A5000))', 5000],
    ['=ROWS(ISNUMBER(B1:B5000))', 5000],
    ['=ROWS(IF(B1:B5000>0,1,0))', 5000],
    ['=ROWS(VSTACK(A1:A5000))', 5000],
    ['=ROWS(HSTACK(A1:A5000))', 5000],
    ['=ROWS(WRAPROWS(A1:A5000,2))', 2500],
    ['=ROWS(BYROW(A1:A5000,LAMBDA(r,1)))', 5000],
    ['=ROWS(SCAN(0,A1:A5000,LAMBDA(a,b,a+1)))', 5000],
    ['=COUNTBLANK(A1:A5000)', 4997],
    ['=COUNTIF(A1:A5000,"")', 4997],
    ['=COUNTIFS(A1:A5000,"",B1:B5000,"")', 4997],
  ])('%s → %s', (formula, expected) => {
    const { wb, id } = book();
    expect(at(wb, id, formula)).toBe(expected);
  });

  it('reads the last cells of the reference as blank, not the last cells with data', () => {
    const { wb, id } = book();
    wb.setInput(id, 1499, 0, 'deep');
    expect(at(wb, id, '=TAKE(A1:A5000,-1)')).toBe(0);
    expect(at(wb, id, '=CHOOSEROWS(A1:A5000,-1)')).toBe(0);
    expect(at(wb, id, '=TAKE(A1:A1500,-1)')).toBe('deep');
    expect(at(wb, id, '=INDEX(A1:A5000,1500)')).toBe('deep');
  });

  it('leaves whole columns to their read window and lets a huge bounded reference stand for every cell it names', () => {
    const { wb, id } = book();
    const t0 = performance.now();
    expect(at(wb, id, '=SUM(B:B)')).toBe(7);
    expect(at(wb, id, '=ROWS(TOCOL(A:A))')).toBeLessThan(5000);
    expect(at(wb, id, '=ROWS(SORT(A1:A200000))')).toBe(200000);
    expect(at(wb, id, '=ROWS(A1:A200000)')).toBe(200000);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
