import { afterEach, describe, expect, it } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { setLocale } from '../src/core/format.js';
import { workbookFromFile } from '../src/core/io.js';

afterEach(() => setLocale('en-US'));

// A typed $1,000 showed $1,000.00 while a typed 1,000 showed 1,000 and 5% showed 5%: the decimals an entry
// was typed with refined the Percent and Number formats it implied but not Currency. A typed $1,000 now
// takes $#,##0 and $1,000.50 takes $#,##0.00, so the entry shows the decimals it was typed with.
describe('a typed currency', () => {
  it.each([
    ['$1,000', 1000, 'USD', 0, '$1,000'],
    ['$1,000.50', 1000.5, 'USD', 2, '$1,000.50'],
    ['$1,000.5', 1000.5, 'USD', 2, '$1,000.50'],
    ['$5', 5, 'USD', 0, '$5'],
    ['€5', 5, 'EUR', 0, '€5'],
    ['£12.50', 12.5, 'GBP', 2, '£12.50'],
    ['-$5', -5, 'USD', 0, '-$5'],
    ['($1,234.50)', -1234.5, 'USD', 2, '-$1,234.50'],
    ['$ 1,200', 1200, 'USD', 0, '$1,200'],
    ['5$', 5, 'USD', 0, '$5'],
    ['$5.', 5, 'USD', 0, '$5'],
  ])('%s shows the decimals it was typed with', (text, value, cur, dec, display) => {
    expect(cellFromInput(text, undefined)).toEqual({ v: value, f: null, s: { fmt: 'currency', cur, dec } });
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, text);
    expect(wb.getCell(id, 0, 0)).toEqual({ v: value, f: null, s: { fmt: 'currency', cur, dec } });
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
  });

  it('counts the digits after the regional format\'s decimal mark', () => {
    setLocale('de-DE');
    expect(cellFromInput('1.234,50 €', undefined).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 2 });
    expect(cellFromInput('1.234 €', undefined).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 0 });
    expect(cellFromInput('5,5 €', undefined).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 2 });
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1.234 €');
    expect(wb.getDisplay(id, 0, 0)).toBe('1.234 €');
    setLocale('ja-JP');
    wb.setInput(id, 1, 0, '￥1,235');
    expect(wb.getCell(id, 1, 0).s).toEqual({ fmt: 'currency', cur: 'JPY', dec: 0 });
    expect(wb.getDisplay(id, 1, 0)).toBe('￥1,235');
  });

  it('leaves the decimals of a cell already in a currency, whatever is typed', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, parseRange('A1'), { fmt: 'currency', cur: 'USD' });
    wb.applyStyle(id, parseRange('A2'), { fmt: 'currency', cur: 'EUR', dec: 1 });
    wb.setInput(id, 0, 0, '$1,000');
    wb.setInput(id, 1, 0, '$5');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'USD' });
    expect(wb.getDisplay(id, 0, 0)).toBe('$1,000.00');
    expect(wb.getCell(id, 1, 0).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 1 });
    expect(wb.getDisplay(id, 1, 0)).toBe('€5.0');
  });

  it('applies through a paste, a fill, Convert to numbers and a CSV import', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.pasteValues(id, [['$1,000', '$1,000.50']], 0, 0);
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'USD', dec: 0 });
    expect(wb.getCell(id, 0, 1).s).toEqual({ fmt: 'currency', cur: 'USD', dec: 2 });
    wb.fillInput(id, parseRange('B2:B3'), '€5', { r: 1, c: 1 });
    expect(wb.getCell(id, 2, 1)).toEqual({ v: 5, f: null, s: { fmt: 'currency', cur: 'EUR', dec: 0 } });
    wb.setInput(id, 3, 0, "'$1,000");
    wb.transformText(id, parseRange('A4'), 'number');
    expect(wb.getCell(id, 3, 0)).toEqual({ v: 1000, f: null, s: { fmt: 'currency', cur: 'USD', dec: 0 } });
    expect(wb.getDisplay(id, 3, 0)).toBe('$1,000');
    const imported = await workbookFromFile(new TextEncoder().encode('$1000,"$1,000.50"\n'), 'amounts.csv');
    expect(imported.getCell(imported.activeSheetId, 0, 0)).toEqual({ v: 1000, f: null, s: { fmt: 'currency', cur: 'USD', dec: 0 } });
    expect(imported.getDisplay(imported.activeSheetId, 0, 0)).toBe('$1,000');
    expect(imported.getCell(imported.activeSheetId, 0, 1)).toEqual({ v: 1000.5, f: null, s: { fmt: 'currency', cur: 'USD', dec: 2 } });
  });
});
