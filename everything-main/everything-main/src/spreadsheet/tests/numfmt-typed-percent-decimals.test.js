import { afterEach, describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { setLocale, typedDecimals } from '../src/core/format.js';
import { workbookFromFile } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

describe('a typed percent in a cell that keeps another format', () => {
  it('leaves the currency format and its decimals alone, so $5.00 then 5% reads $0.05', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    // A typed currency keeps the decimals it was typed with, as a percent does: $5.00 is a two-place cell.
    wb.setInput(id, 0, 0, '$5.00');
    wb.setInput(id, 0, 0, '5%');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'USD', dec: 2 });
    expect(wb.getDisplay(id, 0, 0)).toBe('$0.05');
  });

  it.each([
    [{ fmt: 'number' }, '5%'],
    [{ fmt: 'scientific' }, '5%'],
    [{ fmt: 'currency', cur: 'EUR' }, '5.25%'],
  ])('does not stamp a decimal count onto %j when %s is typed', (style, text) => {
    expect(cellFromInput(text, style).s).toEqual(style);
  });

  it('still stamps the decimals a percent was typed with onto a General cell', () => {
    expect(cellFromInput('5%', undefined).s).toEqual({ fmt: 'percent', dec: 0 });
    expect(cellFromInput('5.25%', { bold: true }).s).toEqual({ bold: true, fmt: 'percent', dec: 2 });
  });

  it('keeps the currency when Convert to numbers reads a percent in a currency cell', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, parseRange('A1'), { fmt: 'currency', cur: 'USD' });
    wb.setInput(id, 0, 0, "'5%");
    wb.transformText(id, parseRange('A1'), 'number');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 0.05, f: null, s: { fmt: 'currency', cur: 'USD' } });
  });
});

describe('percent decimals under a comma-decimal locale', () => {
  it('counts the fraction digits after the locale decimal mark', () => {
    expect(typedDecimals('5.5%')).toBe(2);
    expect(typedDecimals('5%')).toBe(0);
    expect(typedDecimals('1,000%')).toBe(0);
    expect(typedDecimals('5,5%', 'de-DE')).toBe(2);
    expect(typedDecimals('5%', 'de-DE')).toBe(0);
    expect(typedDecimals('1.000%', 'de-DE')).toBe(0);
    expect(typedDecimals(null)).toBe(0);
  });

  it('keeps the half of a typed 5,5% instead of rounding it to 6 %', () => {
    setLocale('de-DE');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5,5%');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'percent', dec: 2 });
    expect(wb.getDisplay(id, 0, 0)).toMatch(/^5,50\s?%$/);
    wb.setInput(id, 1, 0, '7%');
    expect(wb.getCell(id, 1, 0).s).toEqual({ fmt: 'percent', dec: 0 });
  });

  it('applies the same rule when text is converted to numbers and when a CSV is imported', async () => {
    setLocale('de-DE');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'5,5%");
    wb.transformText(id, parseRange('A1'), 'number');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'percent', dec: 2 });
    const imported = await workbookFromFile(new TextEncoder().encode('5,5%;7%'), 'rates.csv');
    expect(imported.getCell(imported.activeSheetId, 0, 0).s).toEqual({ fmt: 'percent', dec: 2 });
    expect(imported.getCell(imported.activeSheetId, 0, 1).s).toEqual({ fmt: 'percent', dec: 0 });
  });
});
