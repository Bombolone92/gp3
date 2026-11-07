import { afterEach, describe, expect, it } from 'vitest';
import { parseInput, editText, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { workbookFromFile } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

describe('typed mixed fractions', () => {
  it.each([
    ['1 1/2', 1.5, '# ?/?'],
    ['-2 3/4', -2.75, '# ?/?'],
    ['2 3/4', 2.75, '# ?/?'],
    ['0 1/2', 0.5, '# ?/?'],
    ['1 3/2', 2.5, '# ?/?'],
    ['+1 1/2', 1.5, '# ?/?'],
    ['1 1/16', 1.0625, '# ??/??'],
    ['3 1/100', 3.01, '# ???/???'],
    ['  1 1/2 ', 1.5, '# ?/?'],
  ])('reads %s as %s with the fraction format %s', (text, value, code) => {
    expect(parseInput(text)).toEqual({ v: value, f: null, fmt: 'custom', code });
  });

  it('keeps a plain 1/2 a date and rejects a zero denominator', () => {
    expect(parseInput('1/2').fmt).toBe('date');
    expect(parseInput('1 1/0')).toEqual({ v: '1 1/0', f: null, fmt: null });
    expect(parseInput('1 1/2/3').v).toBe('1 1/2/3');
    expect(parseInput('1 1 /2').v).toBe('1 1 /2');
  });

  it('reads the same shape under a comma-decimal locale', () => {
    setLocale('de-DE');
    expect(parseInput('1 1/2')).toEqual({ v: 1.5, f: null, fmt: 'custom', code: '# ?/?' });
    expect(parseInput('1,5')).toEqual({ v: 1.5, f: null, fmt: null });
    expect(parseInput('1.000,5')).toEqual({ v: 1000.5, f: null, fmt: 'number' });
  });
});

describe('a mixed fraction in a cell', () => {
  it('shows as typed, edits as its value, and formats as a fraction', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1 1/2');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 1.5, f: null, s: { fmt: 'custom', code: '# ?/?' } });
    expect(wb.getDisplay(id, 0, 0)).toBe('1 1/2');
    expect(editText(wb.getCell(id, 0, 0))).toBe('1.5');
    wb.setInput(id, 1, 0, '-2 3/4');
    expect(wb.getDisplay(id, 1, 0)).toBe('-2 3/4');
    wb.setInput(id, 2, 0, '1 1/16');
    expect(wb.getDisplay(id, 2, 0)).toBe('1  1/16');
    wb.setInput(id, 0, 0, '2.25');
    expect(wb.getDisplay(id, 0, 0)).toBe('2 1/4');
  });

  it('keeps a format the cell already has', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, parseRange('A1'), { fmt: 'number', dec: 2 });
    wb.applyStyle(id, parseRange('A2'), { fmt: 'custom', code: '0.0' });
    wb.applyStyle(id, parseRange('A3'), { fmt: 'text' });
    wb.setInput(id, 0, 0, '1 1/2');
    wb.setInput(id, 1, 0, '1 1/2');
    wb.setInput(id, 2, 0, '1 1/2');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 1.5, f: null, s: { fmt: 'number', dec: 2 } });
    expect(wb.getDisplay(id, 0, 0)).toBe('1.50');
    expect(wb.getCell(id, 1, 0)).toEqual({ v: 1.5, f: null, s: { fmt: 'custom', code: '0.0' } });
    expect(wb.getCell(id, 2, 0)).toEqual({ v: '1 1/2', f: null, s: { fmt: 'text' } });
  });

  it('is read the same way by Convert to numbers and by a CSV import', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'1 1/2");
    wb.transformText(id, parseRange('A1'), 'number');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 1.5, f: null, s: { fmt: 'custom', code: '# ?/?' } });
    const imported = await workbookFromFile(new TextEncoder().encode('1 1/2,x'), 'cups.csv');
    expect(imported.getCell(imported.activeSheetId, 0, 0)).toEqual({ v: 1.5, f: null, s: { fmt: 'custom', code: '# ?/?' } });
    expect(imported.getDisplay(imported.activeSheetId, 0, 0)).toBe('1 1/2');
  });
});
