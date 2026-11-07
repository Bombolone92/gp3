import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A whole column is read only as far as its own sheet's used area, and an operator or an
// elementwise function built an array from it with no record of the column it stood for. Two whole
// columns of different sheets therefore paired only while both were bare references: the
// SUMPRODUCT(column, --(condition)) idiom — the most-copied way to write a conditional sum, and the
// only way to write one over a computed condition — answered a bare #VALUE! or #N/A whenever the two
// columns lived on different sheets, which is the shape of every summary-sheet-over-a-data-sheet
// model. The same formula written with bounded ranges worked, so it looked arbitrary.

function model() {
  const wb = new Workbook({ sheets: [
    { name: 'Sheet1', rows: 30, cols: 6, cells: { '0,0': { v: 10 }, '1,0': { v: 20 }, '2,0': { v: 30 } } },
    { name: 'Data', rows: 30, cols: 6, cells: { '0,2': { v: 1 }, '1,2': { v: 1 }, '2,2': { v: 0 }, '3,2': { v: 1 }, '4,2': { v: 1 } } },
    { name: 'Report', rows: 30, cols: 6, cells: {} },
  ] });
  const id = wb.sheetByName('Report').id;
  return (formula) => { wb.setInput(id, 0, 0, `=${formula}`); return wb.getValue(id, 0, 0); };
}

describe('an array computed from a whole column of another sheet', () => {
  it.each([
    ['SUMPRODUCT(Sheet1!A:A,Data!C:C)', 30], // already worked: two bare references
    ['SUMPRODUCT(Sheet1!A:A,--(Data!C:C>0))', 30],
    ['SUMPRODUCT(--(Sheet1!A:A>15),--(Data!C:C>0))', 1],
    ['SUMPRODUCT((Sheet1!A:A>0)*(Data!C:C>0))', 2],
    ['SUMPRODUCT(N(Sheet1!A:A),N(Data!C:C))', 30],
    ['SUM(Sheet1!A:A*--(Data!C:C>0))', 30],
    ['SUM(FILTER(Sheet1!A:A,Data!C:C>0))', 30],
    ['SUMXMY2(Sheet1!A:A,--(Data!C:C>0))', 1342],
  ])('pairs with the other sheet\'s column in %s', (formula, want) => {
    expect(model()(formula)).toBe(want);
  });

  it('pairs them for CORREL too', () => {
    expect(model()('CORREL(Sheet1!A:A,--(Data!C:C>0))')).toBeCloseTo(-Math.sqrt(3) / 2, 12);
  });

  it('leaves the forms that already worked exactly as they were', () => {
    const at = model();
    expect(at('SUMPRODUCT(Sheet1!A1:A5,--(Data!C1:C5>0))')).toBe(30); // bounded, both sheets
    expect(at('SUMPRODUCT(Sheet1!A:A,--(Sheet1!A:A>15))')).toBe(50); // one sheet, one read window
    expect(at('SUMIFS(Sheet1!A:A,Data!C:C,">0")')).toBe(30);
    expect(at('COUNTIFS(Sheet1!A:A,">0",Data!C:C,">0")')).toBe(2);
    expect(at('SUMPRODUCT({1,2,3},{1,2,3})')).toBe(14);
    expect(at('SUMPRODUCT(--{1,2,3},{1,2,3})')).toBe(14);
    expect(at('SUMPRODUCT(SEQUENCE(3),Sheet1!A1:A3)')).toBe(140);
  });

  it('still refuses two shapes that really do not pair', () => {
    const at = model();
    // A bounded column beside a whole one names different cells, whatever was read of either.
    expect(at('SUMPRODUCT(Sheet1!A1:A3,--(Data!C:C>0))')).toEqual({ error: '#VALUE!' });
    expect(at('SUMPRODUCT(Sheet1!A:A,--(Data!C1:C5>0))')).toEqual({ error: '#VALUE!' });
    expect(at('SUMPRODUCT(Sheet1!A1:A3,--(Data!C1:C5>0))')).toEqual({ error: '#VALUE!' });
  });

  it('follows the data as it changes on either sheet', () => {
    const wb = new Workbook({ sheets: [
      { name: 'Sheet1', rows: 30, cols: 6, cells: { '0,0': { v: 10 }, '1,0': { v: 20 }, '2,0': { v: 30 } } },
      { name: 'Data', rows: 30, cols: 6, cells: { '0,2': { v: 1 }, '1,2': { v: 1 }, '2,2': { v: 0 } } },
      { name: 'Report', rows: 30, cols: 6, cells: {} },
    ] });
    const report = wb.sheetByName('Report').id;
    wb.setInput(report, 0, 0, '=SUMPRODUCT(Sheet1!A:A,--(Data!C:C>0))');
    expect(wb.getValue(report, 0, 0)).toBe(30);
    wb.setInput(wb.sheetByName('Data').id, 2, 2, '5');
    expect(wb.getValue(report, 0, 0)).toBe(60);
    wb.setInput(wb.sheetByName('Sheet1').id, 3, 0, '40');
    expect(wb.getValue(report, 0, 0)).toBe(60); // Data!C4 is blank, so row 4 counts nothing
    wb.setInput(wb.sheetByName('Data').id, 3, 2, '1');
    expect(wb.getValue(report, 0, 0)).toBe(100);
    wb.undo();
    expect(wb.getValue(report, 0, 0)).toBe(60);
  });
});
