import { describe, expect, it } from 'vitest';
import { parseInput, parseDate, formatValue, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile } from '../src/core/io.js';

describe('typed dates before the calendar', () => {
  it.each(['6/15/1850', '1000-01-01', '1899-12-29', '1899-12-30', '1899-12-31', 'Jan 1, 1850', '1 Jan 1850', '6/15/1850 10:00', '1850-06-15 10:00'])('keeps %s as text instead of a serial that shows #####', (text) => {
    expect(parseInput(text)).toEqual({ v: text, f: null, fmt: null });
    expect(parseDate(text)).toBeNull();
  });

  it('reads dates from January 1900 including its fictitious leap day', () => {
    expect(parseInput('1900-02-29')).toEqual({ v: 60, f: null, fmt: 'date' });
    expect(parseInput('1900-01-01')).toEqual({ v: ymdToSerial(1900, 1, 1), f: null, fmt: 'date' });
    expect(parseInput('1/1/1900').v).toBe(ymdToSerial(1900, 1, 1));
    expect(parseInput('Jan 1, 1900').v).toBe(ymdToSerial(1900, 1, 1));
  });

  it('shows the marker for a computed negative serial as before', () => {
    expect(formatValue(-1, { fmt: 'date' })).toBe('#####');
    expect(formatValue(-18095, { fmt: 'custom', code: 'yyyy-mm-dd' })).toBe('#####');
  });

  it('keeps such text when typed and when imported from CSV', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '6/15/1850');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: '6/15/1850', f: null });
    expect(wb.getDisplay(id, 0, 0)).toBe('6/15/1850');
    const imported = await workbookFromFile(new TextEncoder().encode('born\n6/15/1850\n'), 'people.csv');
    expect(imported.getCell(imported.activeSheetId, 1, 0)).toEqual({ v: '6/15/1850', f: null, s: undefined });
  });
});
