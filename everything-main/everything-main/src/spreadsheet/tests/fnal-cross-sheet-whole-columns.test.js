import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A whole column is read only to its own sheet's used area, so Data!A:A and B:B arrived with
// different lengths although both name every row. XLOOKUP answered #N/A for a key it had found
// when the return column's sheet was shorter, FILTER and SORTBY answered #VALUE! for a mismatch
// that was not one, and HSTACK and MAP filled the shorter sheet's rows with #N/A. The operators
// pair such columns cell by cell (0874b23) and COUNTIFS counts them (a5105b4); the functions now
// read the shorter window as blank there too. Bounded ranges are read whole, so a genuine
// mismatch is judged as before.
describe('two whole columns from different sheets in one function', () => {
  const NA = { error: '#N/A' };
  const VALUE = { error: '#VALUE!' };
  const book = () => {
    const wb = new Workbook({ sheets: [{ name: 'Sheet1' }, { name: 'Data' }] });
    const s1 = wb.sheets[0].id;
    const data = wb.sheets[1].id;
    for (let r = 0; r < 40; r++) {
      wb.setInput(data, r, 0, `k${r + 1}`);
      wb.setInput(data, r, 1, String((r + 1) * 10));
      if (r % 3 === 0) wb.setInput(data, r, 2, 'x');
    }
    wb.setInput(s1, 0, 0, 'k30');
    for (let r = 0; r < 3; r++) wb.setInput(s1, r, 1, `b${r + 1}`);
    let row = 1;
    const at = (f) => { const r = row++; wb.setInput(s1, r, 4, f); return wb.getValue(s1, r, 4); };
    return { at };
  };

  it('XLOOKUP answers the blank cell of the shorter return column, not #N/A or if_not_found', () => {
    const { at } = book();
    expect(at('=XLOOKUP(A1,Data!A:A,B:B)')).toBe(0);
    expect(at('=XLOOKUP(A1,Data!A:A,B:B,"nf")')).toBe(0);
    expect(at('=XLOOKUP("k2",Data!A:A,B:B)')).toBe('b2');
    expect(at('=XLOOKUP("b2",B:B,Data!A:A)')).toBe('k2');
    expect(at('=XLOOKUP(A1,Data!A:A,Data!B:B)')).toBe(300);
    expect(at('=XLOOKUP(A1,Data!A:A,Data!C:C)')).toBe(0); // the same answer as a blank cell inside the window
    expect(at('=LOOKUP(300,Data!B:B,B:B)')).toBe(0);
  });

  it('FILTER and SORTBY take the columns as the same height', () => {
    const { at } = book();
    expect(at('=ROWS(FILTER(B:B,Data!C:C="x"))')).toBe(14);
    expect(at('=INDEX(FILTER(B:B,Data!C:C="x"),1,1)')).toBe('b1');
    expect(at('=INDEX(FILTER(B:B,Data!C:C="x"),2,1)')).toBe(0);
    expect(at('=ROWS(FILTER(Data!A:A,Data!C:C="x"))')).toBe(14);
    expect(at('=ROWS(SORTBY(B:B,Data!B:B,-1))')).toBe(40);
    expect(at('=INDEX(SORTBY(B:B,Data!B:B,-1),40,1)')).toBe('b1');
    expect(at('=INDEX(SORTBY(B:B,Data!B:B,-1),1,1)')).toBe(0);
  });

  it('HSTACK, VSTACK and MAP read the shorter sheet as blank rather than #N/A', () => {
    const { at } = book();
    expect(at('=INDEX(HSTACK(B:B,Data!A:A),30,1)')).toBe(0);
    expect(at('=INDEX(HSTACK(B:B,Data!A:A),30,2)')).toBe('k30');
    expect(at('=INDEX(HSTACK(B:B,Data!A:A),2,1)')).toBe('b2');
    expect(at('=ROWS(HSTACK(B:B,Data!A:A))')).toBe(40);
    expect(at('=INDEX(MAP(B:B,Data!B:B,LAMBDA(a,b,a&b)),30,1)')).toBe('300');
    expect(at('=INDEX(MAP(B:B,Data!B:B,LAMBDA(a,b,a&b)),1,1)')).toBe('b110');
    expect(at('=INDEX(B:B&Data!B:B,30,1)')).toBe('300');
    // Whole rows pair column for column the same way; a stack pads only the axis it pairs.
    expect(at('=INDEX(VSTACK(Data!1:1,1:1),1,5)')).toBe(0);
    expect(at('=INDEX(VSTACK(Data!1:1,1:1),1,3)')).toBe('x');
    expect(at('=ROWS(VSTACK(B:B,Data!A:A))')).toBeLessThan(80); // B's window is not padded to Data's 40 rows before stacking
    expect(at('=COUNTA(VSTACK(B:B,Data!A:A))')).toBe(43);
  });

  it('GROUPBY, PIVOTBY and SORT group and sort them together', () => {
    const { at } = book();
    expect(at('=ROWS(GROUPBY(Data!C:C,B:B,SUM))')).toBe(3); // the "x" rows, the blank ones, and the total
    expect(at('=INDEX(GROUPBY(C:C,Data!B:B,SUM),1,2)')).toBe(8200);
    expect(at('=INDEX(GROUPBY(Data!C:C,Data!B:B,SUM),1,2)')).toBe(5330);
    expect(at('=ROWS(PIVOTBY(Data!C:C,Data!A:A,B:B,SUM))')).toBe(4);
    expect(at('=COLUMNS(PIVOTBY(Data!C:C,A:A,Data!B:B,SUM))')).toBe(4); // A holds one key, and blank for the rest of Data's rows
    expect(at('=ROWS(SORT(Data!A:A,B:B,-1))')).toBe(40); // Sheets' separate key column
    expect(at('=INDEX(SORT(Data!A:A,B:B,-1),1,1)')).toBe('k3');
    expect(at('=INDEX(SORT(Data!A:A,B:B,1),1,1)')).toBe('k1');
  });

  it('still judges bounded ranges by their own shape', () => {
    const { at } = book();
    expect(at('=ROWS(GROUPBY(Data!C1:C40,B1:B3,SUM))')).toEqual(VALUE);
    expect(at('=ROWS(SORT(Data!A1:A40,B1:B3,-1))')).toEqual(VALUE);
    expect(at('=ROWS(FILTER(B1:B3,Data!C1:C40="x"))')).toEqual(VALUE);
    expect(at('=XLOOKUP(A1,Data!A1:A40,B1:B3)')).toEqual(VALUE);
    expect(at('=ROWS(SORTBY(B1:B3,Data!B1:B40,-1))')).toEqual(VALUE);
    expect(at('=INDEX(HSTACK(B1:B3,Data!A1:A5),5,1)')).toEqual(NA);
    expect(at('=INDEX(MAP(B1:B3,Data!B1:B5,LAMBDA(a,b,a&b)),5,1)')).toEqual(NA);
  });
});
