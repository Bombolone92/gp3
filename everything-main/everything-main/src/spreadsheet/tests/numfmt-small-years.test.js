import { describe, expect, it } from 'vitest';
import { parseInput, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

describe('typed years 0000 to 0099', () => {
  it.each(['0050-01-01', '0099-12-31', '0000-01-01', '1/1/0050', '0050/1/1', 'Jan 1, 0050', '1 Jan 0050', 'Feb 0050', '0050-01-01 10:00'])('keep %s as text instead of a year in the 1900s', (text) => {
    expect(parseInput(text)).toEqual({ v: text, f: null, fmt: null });
  });

  it('still read four-digit years from 1900 and two-digit years into 1930 to 2029', () => {
    expect(parseInput('2050-01-01').v).toBe(ymdToSerial(2050, 1, 1));
    expect(parseInput('1950-01-01').v).toBe(ymdToSerial(1950, 1, 1));
    expect(parseInput('1/1/50').v).toBe(ymdToSerial(1950, 1, 1));
    expect(parseInput('1/1/29').v).toBe(ymdToSerial(2029, 1, 1));
    expect(parseInput('Jan 1, 50').v).toBe(ymdToSerial(1950, 1, 1));
  });

  it('leave DATE() adding 1900 to a small year', () => {
    expect(calc('DATE(50,1,1)')).toBe(ymdToSerial(1950, 1, 1));
    expect(calc('DATE(0,1,1)')).toBe(ymdToSerial(1900, 1, 1));
    expect(calc('YEAR(DATE(50,1,1))')).toBe(1950);
  });

  it('keep the text when typed into a cell', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '0050-01-01');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: '0050-01-01', f: null });
    expect(wb.getDisplay(id, 0, 0)).toBe('0050-01-01');
  });
});
