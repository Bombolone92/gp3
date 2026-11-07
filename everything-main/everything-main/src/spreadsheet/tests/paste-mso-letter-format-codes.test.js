// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';

// Any mso-number-format code made of letters alone was taken for one of Excel's named formats and, when
// the name was unknown, dropped as General: a year column written as yyyy, a month as mmm or a weekday as
// dddd pasted as 45000 where the source showed 2023. Our own export wrote such cells the same way and read
// them back as General.
function pasted(html) {
  const parsed = parseHtmlClipboard(html);
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, cellsFromHtmlRows(parsed.rows, () => undefined).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  return { cell: (c) => wb.getCell(id, 0, c), shown: (c) => wb.getDisplay(id, 0, c) };
}

describe('letter-only Excel number format codes', () => {
  it('keeps yyyy, mmm, mmmm, dddd and hh as codes, so the pasted serial shows as the source did', () => {
    const { cell, shown } = pasted(`<html><head><style>
      .xl65 {mso-number-format:yyyy;} .xl66 {mso-number-format:mmm;} .xl67 {mso-number-format:"mmmm";} .xl68 {mso-number-format:dddd;} .xl69 {mso-number-format:"hh";}
    </style></head><body><table><tr>
      <td class=xl65 x:num="45000">2023</td><td class=xl66 x:num="45000">Mar</td><td class=xl67 x:num="45000">March</td>
      <td class=xl68 x:num="45000">Wednesday</td><td class=xl69 x:num="45000.75">18</td>
    </tr></table></body></html>`);
    expect(cell(0)).toEqual({ v: 45000, f: null, s: { fmt: 'custom', code: 'yyyy' } });
    expect([0, 1, 2, 3, 4].map(shown)).toEqual(['2023', 'Mar', 'March', 'Wednesday', '18']);
  });

  it('still reads Excel\'s named formats, the ones it also writes for currency, yes/no and general number included', () => {
    const { cell, shown } = pasted(`<html><head><style>
      .xl65 {mso-number-format:Percent;} .xl66 {mso-number-format:"Short Date";} .xl67 {mso-number-format:Currency;} .xl68 {mso-number-format:"Euro Currency";}
      .xl69 {mso-number-format:"Yes\\/No";} .xl70 {mso-number-format:"General Number";} .xl71 {mso-number-format:Standard;} .xl72 {mso-number-format:"On\\/Off";}
    </style></head><body><table><tr>
      <td class=xl65 x:num="0.25">25.00%</td><td class=xl66 x:num="45658">1/2/2025</td><td class=xl67 x:num="1234.5">$1,234.50</td><td class=xl68 x:num="1234.5">€1,234.50</td>
      <td class=xl69 x:num="1">Yes</td><td class=xl70 x:num="7">7</td><td class=xl71 x:num="1234.5">1,234.50</td><td class=xl72 x:num="0">Off</td>
    </tr></table></body></html>`);
    expect(cell(0).s).toEqual({ fmt: 'percent', dec: 2, group: false });
    expect(shown(0)).toBe('25.00%');
    expect(cell(1).s).toEqual({ fmt: 'date' });
    expect(cell(2).s).toMatchObject({ fmt: 'currency', cur: 'USD', dec: 2 });
    expect(cell(3).s).toMatchObject({ fmt: 'currency', cur: 'EUR', dec: 2 });
    expect(shown(4)).toBe('Yes');
    expect(cell(5)).toEqual({ v: 7, f: null });
    expect(shown(6)).toBe('1,234.50');
    expect(shown(7)).toBe('Off');
  });

  it('reads a year cell back from the markup this app writes', () => {
    const html = cellsToHtml([['2023']], [[{ v: 45000, s: { fmt: 'custom', code: 'yyyy' } }]], null, [[45000]]);
    expect(html).toContain('mso-number-format:&quot;yyyy&quot;');
    const { cell, shown } = pasted(html.replace(/ data-spreadsheet-(cells|values)="[^"]*"/g, ''));
    expect(cell(0)).toEqual({ v: 45000, f: null, s: { fmt: 'custom', code: 'yyyy', wrap: false, valign: 'middle' } });
    expect(shown(0)).toBe('2023');
  });
});
