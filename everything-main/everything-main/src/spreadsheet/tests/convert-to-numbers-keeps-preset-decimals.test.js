import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Convert to numbers refined the cell's format with the decimals or seconds the text carried even when the
// cell kept a format the user had set, so '5% converted in a Percent preset cell stamped dec: 0 onto it and
// a later 12.5% showed 13%. As with a typed entry, the refinement belongs only to a format the text implied.
describe('Convert to numbers in a cell the user formatted', () => {
  const convert = (style, text) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    if (style) wb.applyStyle(id, parseRange('A1'), style);
    wb.setInput(id, 0, 0, text);
    expect(wb.transformText(id, parseRange('A1'), 'number')).toBe(1);
    return [wb.getCell(id, 0, 0), wb.getDisplay(id, 0, 0)];
  };

  it('keeps the default decimals of a Percent or Number preset', () => {
    expect(convert({ fmt: 'percent' }, "'5%")).toEqual([{ v: 0.05, f: null, s: { fmt: 'percent' } }, '5.00%']);
    expect(convert({ fmt: 'number' }, "'1,000")).toEqual([{ v: 1000, f: null, s: { fmt: 'number' } }, '1,000.00']);
    expect(convert({ fmt: 'percent', dec: 1 }, "'5.25%")).toEqual([{ v: 0.0525, f: null, s: { fmt: 'percent', dec: 1 } }, '5.3%']);
  });

  it('keeps a Time preset without seconds', () => {
    expect(convert({ fmt: 'time' }, "'9:05:20")).toEqual([{ v: (9 * 3600 + 5 * 60 + 20) / 86400, f: null, s: { fmt: 'time' } }, '09:05']);
  });

  it('still stamps the typed decimals and seconds onto a General or Plain text cell', () => {
    expect(convert(null, "'5%")).toEqual([{ v: 0.05, f: null, s: { fmt: 'percent', dec: 0 } }, '5%']);
    expect(convert({ fmt: 'text' }, "'5.5%")).toEqual([{ v: 0.055, f: null, s: { fmt: 'percent', dec: 2 } }, '5.50%']);
    expect(convert({ fmt: 'general', bold: true }, "'9:05:20")).toEqual([{ v: (9 * 3600 + 5 * 60 + 20) / 86400, f: null, s: { fmt: 'time', sec: true, bold: true } }, '09:05:20']);
  });
});
