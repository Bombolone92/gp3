import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };

function book() {
  const wb = new Workbook();
  const one = wb.activeSheetId;
  const two = wb.addSheet('Two').id;
  const three = wb.addSheet('Three').id;
  wb.setInput(one, 0, 0, '1');
  wb.setInput(two, 0, 0, '2');
  wb.setInput(three, 5, 0, '=SUM(Sheet1:Two!A1)');
  wb.setInput(three, 6, 0, '=Sheet1!A1');
  expect(wb.getValue(three, 5, 0)).toBe(3);
  return { wb, one, two, three };
}

// A 3D span names the same cells on every sheet between two tabs; moving one sheet's block
// cannot take it along, so it stays where it is. Only plain references follow.
describe('moving cells a 3D reference spans', () => {
  it('leaves the span alone when the block is dragged, while plain references follow', () => {
    const { wb, one, three } = book();
    expect(wb.moveRange(one, A1, 0, 3)).toEqual({ r1: 0, c1: 3, r2: 0, c2: 3 });
    expect(wb.getCell(three, 5, 0).f).toBe('SUM(Sheet1:Two!A1)');
    expect(wb.getValue(three, 5, 0)).toBe(2); // Sheet1!A1 is empty now
    expect(wb.getCell(three, 6, 0).f).toBe('Sheet1!D1');
    expect(wb.getValue(three, 6, 0)).toBe(1);
    wb.undo();
    expect(wb.getCell(three, 5, 0).f).toBe('SUM(Sheet1:Two!A1)');
    expect(wb.getValue(three, 5, 0)).toBe(3);
  });

  it('leaves the span alone when the block is cut and pasted, on the same sheet or another', () => {
    const { wb, one, two, three } = book();
    expect(wb.placeMoved(one, 4, 4, wb.copyRange(one, A1), { sheetId: one, range: A1 })).toEqual({ r1: 4, c1: 4, r2: 4, c2: 4 });
    expect(wb.getCell(three, 5, 0).f).toBe('SUM(Sheet1:Two!A1)');
    expect(wb.getCell(three, 6, 0).f).toBe('Sheet1!E5');
    wb.undo();
    expect(wb.getValue(three, 5, 0)).toBe(3);
    // Across sheets the span would otherwise collapse onto the destination sheet.
    expect(wb.placeMoved(two, 4, 4, wb.copyRange(one, A1), { sheetId: one, range: A1 })).toEqual({ r1: 4, c1: 4, r2: 4, c2: 4 });
    expect(wb.getCell(three, 5, 0).f).toBe('SUM(Sheet1:Two!A1)');
    expect(wb.getValue(three, 5, 0)).toBe(2);
    expect(wb.getCell(three, 6, 0).f).toBe('Two!E5');
  });

  it('keeps a moved formula\'s own span pointing at the same cells', () => {
    const { wb, one, two, three } = book();
    const F6 = { r1: 5, c1: 0, r2: 5, c2: 0 };
    expect(wb.placeMoved(two, 8, 8, wb.copyRange(three, F6), { sheetId: three, range: F6 })).toEqual({ r1: 8, c1: 8, r2: 8, c2: 8 });
    expect(wb.getCell(two, 8, 8).f).toBe('SUM(Sheet1:Two!A1)');
    expect(wb.getValue(two, 8, 8)).toBe(3);
    expect(wb.getCell(three, 5, 0)).toBeUndefined();
    // A block holding the spanned cell and a formula spanning it: the plain reference beside it follows, the span does not.
    wb.setInput(one, 1, 0, '=SUM(Sheet1:Two!A1)');
    wb.setInput(one, 2, 0, '=A1*10');
    const block = { r1: 0, c1: 0, r2: 2, c2: 0 };
    expect(wb.placeMoved(two, 4, 4, wb.copyRange(one, block), { sheetId: one, range: block })).toEqual({ r1: 4, c1: 4, r2: 6, c2: 4 });
    expect(wb.getCell(two, 5, 4).f).toBe('SUM(Sheet1:Two!A1)');
    expect(wb.getValue(two, 5, 4)).toBe(2);
    expect(wb.getCell(two, 6, 4).f).toBe('E5*10');
    expect(wb.getValue(two, 6, 4)).toBe(10);
  });
});
