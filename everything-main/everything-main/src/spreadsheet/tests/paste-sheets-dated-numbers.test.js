// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';

// A number Google Sheets typed in data-sheets-value whose text did not re-parse to the same value was
// written bare, with no format: "2 Jan", "Tuesday", "Jan-24" and "Q1 2024" all pasted as 45293. Sheets'
// own number format, in data-sheets-numberformat, was never read.
function pasted(html, prev) {
  const parsed = parseHtmlClipboard(html);
  const wb = new Workbook();
  const id = wb.activeSheetId;
  if (prev) wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 20 }, prev);
  wb.setCells(id, cellsFromHtmlRows(parsed.rows, (i, j) => wb.getCell(id, i, j)?.s).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  return { cell: (c) => wb.getCell(id, 0, c), shown: (c) => wb.getDisplay(id, 0, c) };
}
const typed = (n, text, extra = '') => `<td data-sheets-value='{"1":3,"3":${n}}'${extra}>${text}</td>`;

describe('typed numbers from Sheets whose text is not the number', () => {
  it('reads the number format Sheets writes in data-sheets-numberformat', () => {
    const { cell, shown } = pasted(`<table><tr>
      ${typed(45293, 'Tuesday', ` data-sheets-numberformat='{"1":5,"2":"dddd","3":1}'`)}
      ${typed(45293, '2 Jan', ` data-sheets-numberformat='{"1":5,"2":"d mmm","3":1}'`)}
      ${typed(45293, 'Jan-24', ` data-sheets-numberformat='{"1":5,"2":"mmm-yy","3":1}'`)}
      ${typed(1234.5, '$1,234.50', ` data-sheets-numberformat='{"1":4,"2":"\\"$\\"#,##0.00","3":1}'`)}
      ${typed(1234.5, '1234.5 kg', ` data-sheets-numberformat='{"1":2,"2":"0.0\\" kg\\"","3":1}'`)}
      ${typed(45293, '2024-01-02', ` data-sheets-numberformat='{"1":5}'`)}
      ${typed(7, '7', ` data-sheets-numberformat='{bad'`)}
    </tr></table>`);
    expect(cell(0)).toEqual({ v: 45293, f: null, s: { fmt: 'custom', code: 'dddd' } });
    expect([0, 1, 2, 3, 4, 5].map(shown)).toEqual(['Tuesday', '2 Jan', 'Jan-24', '$1,234.50', '1234.5 kg', '2024-01-02']);
    expect(cell(3).s).toMatchObject({ fmt: 'currency', cur: 'USD', dec: 2 });
    expect(cell(5).s).toEqual({ fmt: 'date' });
    expect(cell(6)).toEqual({ v: 7, f: null });
  });

  it('keeps the serial as a date when the text names its day without the year, and the text when it names no number', () => {
    const { cell, shown } = pasted(`<table><tr>${typed(45293, '2 Jan')}${typed(45293, 'Jan 2')}${typed(45293.5, '12:00')}${typed(45293, 'Tuesday')}${typed(45293, 'Q1 2024')}</tr></table>`);
    expect(cell(0).v).toBe(45293);
    expect(cell(0).s.fmt).toBe('date');
    expect(shown(0)).toMatch(/^Jan 2, 2024$|^2024-01-02$/);
    expect(cell(1).v).toBe(45293);
    expect(cell(2)).toEqual({ v: 45293.5, f: null, s: { fmt: 'time' } });
    expect(cell(3)).toEqual({ v: 'Tuesday', f: null });
    expect(cell(4)).toEqual({ v: 'Q1 2024', f: null });
  });

  it('still leaves a typed number bare when its text read as an unrelated date, and keeps a destination format', () => {
    const { cell } = pasted(`<table><tr><td x:num="0.5"> 1/2</td>${typed(0.75, ' 3/4')}<td x:num="3">3/1</td>${typed(45293, 'Jan-24')}</tr></table>`);
    expect(cell(0)).toEqual({ v: 0.5, f: null });
    expect(cell(1)).toEqual({ v: 0.75, f: null });
    expect(cell(2)).toEqual({ v: 3, f: null });
    expect(cell(3)).toEqual({ v: 45293, f: null }); // the 24th is not the 2nd: no year is implied, so no date either
    // A destination already formatted as currency shows the typed number in it, whatever the text said.
    const money = pasted(`<table><tr>${typed(45293, 'Tuesday')}${typed(45293, '2 Jan')}</tr></table>`, { fmt: 'currency', cur: 'EUR', dec: 0 });
    expect(money.cell(0)).toEqual({ v: 45293, f: null, s: { fmt: 'currency', cur: 'EUR', dec: 0 } });
    expect(money.shown(1)).toBe('€45,293');
  });

  it('shows an Excel weekday or month cell as the source did, through its mso-number-format code', () => {
    const { shown } = pasted(`<table><tr><td style="mso-number-format:dddd" x:num="45293">Tuesday</td><td style="mso-number-format:mmm" x:num="45293">Jan</td></tr></table>`);
    expect([0, 1].map(shown)).toEqual(['Tuesday', 'Jan']);
  });
});
