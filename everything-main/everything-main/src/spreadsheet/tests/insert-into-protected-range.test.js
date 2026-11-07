import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW } from '../src/core/refs.js';

/**
 * Deleting a line out of a protected range is refused, but inserting one inside it was not: the range
 * grew over a blank line nobody could then fill, so anyone could break up a block someone had locked
 * while the opposite edit was refused. Insertions that only move a range whole are still allowed, as
 * deleting a line outside a range is.
 */
function book(range = { r1: 2, c1: 0, r2: 5, c2: 3 }) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 2; r <= 5; r++) for (let c = 0; c <= 3; c++) wb.setInput(id, r, c, `${r}-${c}`);
  wb.protectRange(id, range, 'signed off');
  const said = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') said.push(e.detail); });
  return { wb, id, said, range: () => ({ ...wb.sheet(id).protectedRanges[0].range }) };
}

describe('inserting into a protected range', () => {
  it('refuses a row inside it and says which range and why', () => {
    const { wb, id, said, range } = book();
    expect(wb.insertRows(id, 4, 1)).toBe(false);
    expect(range()).toEqual({ r1: 2, c1: 0, r2: 5, c2: 3 });
    expect(wb.getValue(id, 4, 0)).toBe('4-0');
    expect(said.at(-1)).toMatchObject({ description: 'signed off', range: { r1: 2, r2: 5 } });
  });

  it('refuses a column inside it', () => {
    const { wb, id, range } = book();
    expect(wb.insertCols(id, 2, 1)).toBe(false);
    expect(range()).toEqual({ r1: 2, c1: 0, r2: 5, c2: 3 });
  });

  it('refuses cells shifted down inside it', () => {
    const { wb, id, range } = book();
    expect(wb.insertCells(id, { r1: 4, c1: 0, r2: 4, c2: 3 }, 'down')).toBe(false);
    expect(range()).toEqual({ r1: 2, c1: 0, r2: 5, c2: 3 });
    expect(wb.getValue(id, 4, 0)).toBe('4-0');
  });

  it('refuses rows moved into it', () => {
    const { wb, id, range } = book();
    wb.setInput(id, 8, 0, 'stray');
    expect(wb.moveRows(id, 8, 1, 4)).toBe(null);
    expect(range()).toEqual({ r1: 2, c1: 0, r2: 5, c2: 3 });
    expect(wb.getValue(id, 8, 0)).toBe('stray');
  });

  it('still allows a line above, below or at the range\'s own first line, which only move it', () => {
    const a = book();
    expect(a.wb.insertRows(a.id, 0, 1)).toBe(true);
    expect(a.range()).toEqual({ r1: 3, c1: 0, r2: 6, c2: 3 });
    const b = book();
    expect(b.wb.insertRows(b.id, 2, 1)).toBe(true);
    expect(b.range()).toEqual({ r1: 3, c1: 0, r2: 6, c2: 3 });
    const c = book();
    expect(c.wb.insertRows(c.id, 6, 1)).toBe(true);
    expect(c.range()).toEqual({ r1: 2, c1: 0, r2: 5, c2: 3 });
    const d = book();
    expect(d.wb.moveRows(d.id, 0, 1, 8)).toBe(7);
    expect(d.range()).toEqual({ r1: 1, c1: 0, r2: 4, c2: 3 });
  });

  it('still allows a row inside a protected range that reaches the sheet\'s last line', () => {
    const { wb, id, range } = book({ r1: 0, c1: 5, r2: MAX_ROW, c2: 5 });
    expect(wb.insertRows(id, 4, 1)).toBe(true);
    expect(range()).toEqual({ r1: 0, c1: 5, r2: MAX_ROW, c2: 5 });
  });

  it('leaves the table where it is when Add table row cannot make room', () => {
    // The row below the table holds something, so room has to be made for the new one; the insertion
    // would land inside the protected range and is refused.
    const wb = new Workbook({ sheets: [{ name: 'S',
      cells: { '0,0': { v: 'H' }, '1,0': { v: 'a' }, '2,0': { v: 'below' } },
      tables: [{ id: 't1', name: 'T', range: { r1: 0, c1: 0, r2: 1, c2: 0 } }],
      protectedRanges: [{ id: 'p', range: { r1: 1, c1: 0, r2: 4, c2: 0 }, description: 'signed off' }] }] });
    const id = wb.activeSheetId;
    expect(wb.addTableRow(id, 't1')).toBe(-1);
    expect(wb.sheet(id).tables[0].range).toEqual({ r1: 0, c1: 0, r2: 1, c2: 0 });
    expect(wb.getValue(id, 2, 0)).toBe('below');
    expect(wb.sheet(id).protectedRanges[0].range).toEqual({ r1: 1, c1: 0, r2: 4, c2: 0 });
  });
});
