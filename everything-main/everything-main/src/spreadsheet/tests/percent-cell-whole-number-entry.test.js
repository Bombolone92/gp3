import { describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { editText } from '../src/core/format.js';

const cell = (r) => ({ r1: r, c1: 0, r2: r, c2: 0 });

// A whole number typed into a percent-formatted cell was stored as typed, so 5 showed 500.00%.
// Automatic percent entry reads a number of one or more as that many percent (5 is 5%)
// and multiplies only a number under one by a hundred for display (0.5 is 50%).
describe('a number typed into a percent cell', () => {
  it('is that many percent when it is one or more, and a share when it is less', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 9, c2: 0 }, { fmt: 'percent' });
    const typed = ['5', '0.5', '-5', '1', '100', '1,000', '12%', '0.999', '-0.25', '1e3'];
    typed.forEach((t, r) => wb.setInput(id, r, 0, t));
    expect(typed.map((_, r) => wb.getCell(id, r, 0).v)).toEqual([0.05, 0.5, -0.05, 0.01, 1, 10, 0.12, 0.999, -0.25, 10]);
    // Every entry, a typed "12%" included, keeps the cell's own two decimals, the format the user set.
    expect(typed.map((_, r) => wb.getDisplay(id, r, 0))).toEqual(
      ['5.00%', '50.00%', '-5.00%', '1.00%', '100.00%', '1,000.00%', '12.00%', '99.90%', '-25.00%', '1,000.00%']);
    // The cell keeps its percent format, and editing it shows the percent typed, so it round-trips.
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'percent' });
    expect(editText(wb.getCell(id, 0, 0))).toBe('5%');
    wb.setInput(id, 0, 0, editText(wb.getCell(id, 0, 0)));
    expect(wb.getCell(id, 0, 0).v).toBe(0.05);
  });

  it('leaves formulas, booleans, dates and text alone, and entry into other formats unchanged', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 3, c2: 0 }, { fmt: 'percent' });
    wb.setInput(id, 0, 0, '=5');
    expect(wb.getValue(id, 0, 0)).toBe(5);
    wb.setInput(id, 1, 0, 'TRUE');
    expect(wb.getCell(id, 1, 0).v).toBe(true);
    wb.setInput(id, 2, 0, 'five');
    expect(wb.getCell(id, 2, 0).v).toBe('five');
    // Number and General cells store the number typed.
    wb.applyStyle(id, cell(4), { fmt: 'number', dec: 2 });
    wb.setInput(id, 4, 0, '5');
    expect(wb.getCell(id, 4, 0).v).toBe(5);
    wb.setInput(id, 5, 0, '5');
    expect(wb.getCell(id, 5, 0).v).toBe(5);
    // A percent cell reached through Ctrl+Enter fill reads the entry the same way.
    wb.applyStyle(id, { r1: 6, c1: 0, r2: 7, c2: 0 }, { fmt: 'percent', dec: 0 });
    wb.fillInput(id, { r1: 6, c1: 0, r2: 7, c2: 0 }, '25', { r: 6, c: 0 });
    expect([6, 7].map((r) => wb.getDisplay(id, r, 0))).toEqual(['25%', '25%']);
    // A date typed into a percent cell still stores its serial.
    expect(cellFromInput('1/2', { fmt: 'percent' }).v).toBeGreaterThan(40000);
  });
});
