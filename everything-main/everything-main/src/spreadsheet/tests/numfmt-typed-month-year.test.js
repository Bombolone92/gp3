import { afterEach, describe, expect, it } from 'vitest';
import { parseInput, editText, setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { workbookFromFile } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

describe('a typed month and year', () => {
  it.each(['Feb 2024', 'February 2024', 'feb 2024', 'FEB 2024', 'Feb-2024', 'Feb. 2024'])('reads %s as the first of February 2024 with a month-year format', (text) => {
    expect(parseInput(text)).toEqual({ v: ymdToSerial(2024, 2, 1), f: null, fmt: 'custom', code: 'mmm-yy' });
  });

  it('reads other months and years', () => {
    expect(parseInput('Sept 2025').v).toBe(ymdToSerial(2025, 9, 1));
    expect(parseInput('Mar-2026').v).toBe(ymdToSerial(2026, 3, 1));
    expect(parseInput('December 1999').v).toBe(ymdToSerial(1999, 12, 1));
    expect(parseInput('Jan 1900').v).toBe(ymdToSerial(1900, 1, 1));
    expect(parseInput('Feb 2024', 'de-DE').v).toBe(ymdToSerial(2024, 2, 1));
  });

  it('keeps a month with a day, a bare month, an unknown word, and a year off the calendar as before', () => {
    const year = new Date().getFullYear();
    expect(parseInput('Feb 24')).toEqual({ v: ymdToSerial(year, 2, 24), f: null, fmt: 'date', dateStyle: 'medium' });
    expect(parseInput('Feb 24, 2024').fmt).toBe('date');
    expect(parseInput('May').v).toBe('May');
    expect(parseInput('Foo 2024').v).toBe('Foo 2024');
    expect(parseInput('Feb 1899').v).toBe('Feb 1899');
    expect(parseInput('Feb 20245').v).toBe('Feb 20245');
    expect(parseInput('Fe 2024').v).toBe('Fe 2024');
  });
});

describe('a month and year in a cell', () => {
  it('shows as Feb-24 and edits as the first of the month', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Feb 2024');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: ymdToSerial(2024, 2, 1), f: null, s: { fmt: 'custom', code: 'mmm-yy' } });
    expect(wb.getDisplay(id, 0, 0)).toBe('Feb-24');
    expect(editText(wb.getCell(id, 0, 0))).toBe('2024-02-01');
    wb.setInput(id, 0, 0, '2024-03-15');
    expect(wb.getDisplay(id, 0, 0)).toBe('Mar-24');
  });

  it('keeps a date format the cell already has', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, parseRange('A1'), { fmt: 'date', dateStyle: 'medium' });
    wb.setInput(id, 0, 0, 'Feb 2024');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: ymdToSerial(2024, 2, 1), f: null, s: { fmt: 'date', dateStyle: 'medium' } });
    expect(wb.getDisplay(id, 0, 0)).toBe('Feb 1, 2024');
  });

  it('is read the same way by Convert to numbers and by a CSV import', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'Feb 2024");
    wb.transformText(id, parseRange('A1'), 'number');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: ymdToSerial(2024, 2, 1), f: null, s: { fmt: 'custom', code: 'mmm-yy' } });
    const imported = await workbookFromFile(new TextEncoder().encode('period,amount\nFeb 2024,5\n'), 'periods.csv');
    expect(imported.getCell(imported.activeSheetId, 1, 0)).toEqual({ v: ymdToSerial(2024, 2, 1), f: null, s: { fmt: 'custom', code: 'mmm-yy' } });
    expect(imported.getDisplay(imported.activeSheetId, 1, 0)).toBe('Feb-24');
  });
});
