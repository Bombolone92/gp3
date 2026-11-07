import { describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { editText } from '../src/core/format.js';

// A leading apostrophe used to set the Plain text format on the cell, so every later entry in it
// was stored as text: a 5 typed after '0123 was the text "5", which SUM skipped and sorts grouped
// with words. The apostrophe now marks that one entry only.
describe('a leading apostrophe', () => {
  it('keeps the one entry as text without making the cell Plain text', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'0123");
    expect(wb.getCell(id, 0, 0)).toEqual({ v: '0123', f: null, s: undefined });
    expect(wb.getValue(id, 0, 0)).toBe('0123');
    // The editor still shows the apostrophe, so editing does not turn the text into the number 123.
    expect(editText(wb.getCell(id, 0, 0))).toBe("'0123");
    wb.setInput(id, 0, 0, '5');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 5, f: null, s: undefined });
    wb.setInput(id, 1, 0, '=SUM(A1)');
    expect(wb.getValue(id, 1, 0)).toBe(5);
    // A percent, a date and a fraction typed afterwards take their implied formats as in any other cell.
    wb.setInput(id, 0, 0, '12%');
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 0.12, s: { fmt: 'percent' } });
  });

  it('leaves the other formatting of the cell alone', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, fmt: 'currency' });
    wb.setInput(id, 0, 0, "'1/2");
    expect(wb.getCell(id, 0, 0)).toEqual({ v: '1/2', f: null, s: { bold: true, fmt: 'currency' } });
    wb.setInput(id, 0, 0, '3');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 3, f: null, s: { bold: true, fmt: 'currency' } });
  });

  it('is stripped from a cell the user formatted as Plain text, which stays Plain text', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'text' });
    wb.setInput(id, 0, 0, "'0123");
    expect(wb.getCell(id, 0, 0)).toEqual({ v: '0123', f: null, s: { fmt: 'text' } });
    wb.setInput(id, 0, 0, '5');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: '5', f: null, s: { fmt: 'text' } });
  });

  it('marks text shaped like a formula or a date, and a lone apostrophe is an empty text', () => {
    expect(cellFromInput("'=1+1")).toEqual({ v: '=1+1', f: null, s: undefined });
    expect(cellFromInput("'1/2")).toEqual({ v: '1/2', f: null, s: undefined });
    expect(cellFromInput("'")).toEqual({ v: '', f: null, s: undefined });
    expect(editText(cellFromInput("'=1+1"))).toBe("'=1+1");
    expect(editText(cellFromInput("'"))).toBe("'");
    // Text that needs no apostrophe edits as itself.
    expect(editText(cellFromInput("'abc"))).toBe('abc');
  });
});
