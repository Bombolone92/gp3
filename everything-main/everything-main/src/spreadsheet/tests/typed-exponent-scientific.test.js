import { afterEach, describe, expect, it } from 'vitest';
import { parseInput, setLocale, editText } from '../src/core/format.js';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { workbookFromFile } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

// A number typed in E notation (1e5, 2E+10, 1.5e-3) was stored without a format and displayed as 100000,
// 20000000000 and 0.0015. Such an entry now gets 0.00E+00, as a typed 5% or 1,000 gets % or #,##0.
describe('a number typed in E notation', () => {
  it.each([
    ['1e5', 100000, '1.00E+05'],
    ['2E+10', 2e10, '2.00E+10'],
    ['1.5e-3', 0.0015, '1.50E-03'],
    ['-1e5', -100000, '-1.00E+05'],
    [' 1e5 ', 100000, '1.00E+05'],
    ['1e0', 1, '1.00E+00'],
  ])('gives %s the Scientific format, shown as %s', (text, value, display) => {
    expect(parseInput(text)).toEqual({ v: value, f: null, fmt: 'scientific' });
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, text);
    expect(wb.getCell(id, 0, 0)).toEqual({ v: value, f: null, s: { fmt: 'scientific' } });
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
    expect(parseInput(editText(wb.getCell(id, 0, 0))).v).toBe(value); // edits as its plain digits, which read back
  });

  it('follows the locale decimal mark, and yields to a currency, a percent or thousands separators', () => {
    setLocale('de-DE');
    expect(parseInput('1,5e3')).toEqual({ v: 1500, f: null, fmt: 'scientific' });
    setLocale('en-US');
    expect(parseInput('$1e3')).toEqual({ v: 1000, f: null, fmt: 'currency', cur: 'USD' });
    expect(parseInput('1e2%')).toEqual({ v: 1, f: null, fmt: 'percent' });
    expect(parseInput('1,000e3')).toEqual({ v: 1000000, f: null, fmt: 'number' });
    expect(parseInput('1e400').v).toBe('1e400'); // too large for a cell: text, as before
    expect(parseInput('e5').v).toBe('e5');
  });

  it('leaves a cell that already has a format alone, a percent cell reading 1e3 as that many percent', () => {
    expect(cellFromInput('1e3', { fmt: 'number', dec: 0 })).toEqual({ v: 1000, f: null, s: { fmt: 'number', dec: 0 } });
    expect(cellFromInput('1e3', { fmt: 'percent' })).toEqual({ v: 10, f: null, s: { fmt: 'percent' } });
    expect(cellFromInput('1e3', { fmt: 'currency', cur: 'EUR' })).toEqual({ v: 1000, f: null, s: { fmt: 'currency', cur: 'EUR' } });
    expect(cellFromInput('1e3', { fmt: 'general', bold: true })).toEqual({ v: 1000, f: null, s: { fmt: 'scientific', bold: true } });
  });

  it('is read the same way by Convert to numbers and by a CSV import', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'1e5");
    wb.transformText(id, parseRange('A1'), 'number');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 100000, f: null, s: { fmt: 'scientific' } });
    const imported = await workbookFromFile(new TextEncoder().encode('1e5,100000\n'), 'values.csv');
    expect(imported.getCell(imported.activeSheetId, 0, 0)).toEqual({ v: 100000, f: null, s: { fmt: 'scientific' } });
    expect(imported.getDisplay(imported.activeSheetId, 0, 0)).toBe('1.00E+05');
    expect(imported.getCell(imported.activeSheetId, 0, 1)).toEqual({ v: 100000, f: null, s: undefined });
  });
});
