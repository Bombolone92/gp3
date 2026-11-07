import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A whole column or row is read only to the sheet's used area, so paired with a bounded range in
// array arithmetic it fell short: its cells past the data read #N/A, and read as a single row it
// stretched like a scalar over every row. It stands for every row (column) of its partner.
describe('a whole column or row paired with a bounded range', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 0, 1, '2');
    return { wb, id, at: (f) => { wb.setInput(id, 0, 3, f); return wb.getValue(id, 0, 3); } };
  };

  it('reads the cells past the data as blank, in the shape of the bounded range', () => {
    const { at } = book();
    expect(at('=INDEX(A1:A20+B:B,15)')).toBe(0);
    expect(at('=INDEX(A1:A20+B:B,1)')).toBe(3);
    expect(at('=ROWS(A1:A20+B:B)')).toBe(20);
    expect(at('=SUM(A1:A20*B:B)')).toBe(2);
    expect(at('=INDEX(A1:F1+1:1,1,5)')).toBe(0);
    expect(at('=COLUMNS(A1:F1*1:1)')).toBe(6);
    expect(at('=SUM(B:B+A1:A20)')).toBe(3);
  });

  it('does not stretch a whole column read as one row over every row', () => {
    const { at } = book();
    expect(at('=INDEX(A1:A20+B:B,2)')).toBe(0);
    expect(at('=INDEX(ROUND(A1:A20+1/3,B:B),15)')).toBe(0);
    expect(at('=INDEX(ROUND(A1:A20+1/3,B:B),1)')).toBe(1.33);
  });

  it('keeps #N/A for the bounded range\'s own missing cells and pairs two whole columns cell by cell', () => {
    const { wb, id, at } = book();
    for (let r = 1; r < 5; r++) wb.setInput(id, r, 1, String(r + 2));
    expect(at('=INDEX(A1:A2+B:B,2)')).toBe(3);
    expect(at('=INDEX(A1:A2+B:B,4)')).toEqual({ error: '#N/A' });
    expect(at('=ROWS(ROUND(A1:A2,B:B))')).toBe(5);
    expect(at('=SUM(A:A*B:B)')).toBe(2);
    expect(at('=ROWS(A:A+B:B)')).toBe(5);
  });
});
