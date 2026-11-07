import { afterEach, describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { setLocale } from '../src/core/format.js';

afterEach(() => setLocale('en-US'));

// "Convert to number" on the text €5.50 gave $5.50: transformText took the format and the date style the text
// implied but not its currency, while typing, pasting and importing the same text kept the euro.
describe('Convert to number on text naming a currency', () => {
  it.each([
    ['€5.50', 5.5, 'EUR', '€5.50'],
    ['£12.50', 12.5, 'GBP', '£12.50'],
    ['¥1,235.00', 1235, 'JPY', '¥1,235.00'],
    ['5.50 $', 5.5, 'USD', '$5.50'],
    ['($1,234.50)', -1234.5, 'USD', '-$1,234.50'],
    ['CHF 5.50', 5.5, 'CHF', 'CHF 5.50'],
  ])('keeps the currency of %s, as typing it does', (text, value, cur, display) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, `'${text}`);
    expect(wb.getValue(id, 0, 0)).toBe(text);
    wb.transformText(id, parseRange('A1'), 'number');
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: value, f: null, s: { fmt: 'currency', cur } });
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
    expect(wb.getCell(id, 0, 0).s).toEqual(cellFromInput(text, undefined).s);
  });

  it('follows the regional format', () => {
    setLocale('de-DE');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'5,50 €");
    wb.setInput(id, 1, 0, "'1.234,50 $");
    wb.transformText(id, parseRange('A1:A2'), 'number');
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 5.5, s: { fmt: 'currency', cur: 'EUR' } });
    expect(wb.getDisplay(id, 0, 0)).toBe('5,50 €');
    expect(wb.getCell(id, 1, 0)).toMatchObject({ v: 1234.5, s: { fmt: 'currency', cur: 'USD' } });
    expect(wb.getDisplay(id, 1, 0)).toBe('1.234,50 $');
  });

  it('takes the currency in a Plain text cell, and leaves the currency of a cell already in one', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, parseRange('A1'), { fmt: 'text', bold: true });
    wb.setInput(id, 0, 0, '€5.50');
    wb.applyStyle(id, parseRange('A2'), { fmt: 'currency', cur: 'CHF' });
    wb.setInput(id, 1, 0, "'€5.50");
    wb.transformText(id, parseRange('A1:A2'), 'number');
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 5.5, s: { fmt: 'currency', cur: 'EUR', bold: true } });
    expect(wb.getCell(id, 1, 0)).toEqual({ v: 5.5, f: null, s: { fmt: 'currency', cur: 'CHF' } });
    expect(wb.getDisplay(id, 1, 0)).toBe('CHF 5.50');
  });
});
