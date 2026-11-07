// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';

function pasted(html, prev) {
  const parsed = parseHtmlClipboard(html);
  const wb = new Workbook();
  const id = wb.activeSheetId;
  if (prev) wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, prev);
  wb.setCells(id, cellsFromHtmlRows(parsed.rows, (i, j) => wb.getCell(id, i, j)?.s).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  return { wb, id, parsed, cell: (r, c) => wb.getCell(id, r, c) };
}

describe('typed values in pasted HTML', () => {
  it('keeps Excel text-formatted cells as text, inline or through a class', () => {
    const { cell, parsed } = pasted(`<html><head><style>.xl66 {mso-number-format:"\\@";}</style></head><body><table>
      <tr><td style="mso-number-format:'\\@'">00123</td><td class=xl66>1/2</td><td>00123</td></tr></table></body></html>`);
    expect(parsed.rows[0][0].text).toBe('00123'); // the displayed text is unchanged for values-only and arithmetic pastes
    expect(cell(0, 0)).toEqual({ v: '00123', f: null, s: { fmt: 'text' } });
    expect(cell(0, 1)).toEqual({ v: '1/2', f: null, s: { fmt: 'text' } });
    expect(cell(0, 2).v).toBe(123);
  });

  it('reads the full-precision number Excel carries in x:num, keeping the format the text implies', () => {
    const { cell } = pasted('<table><tr><td x:num="1234.56789">1,234.6</td><td x:num="0.12345">12.3%</td><td x:num>42</td><td x:num="abc">7</td></tr></table>');
    expect(cell(0, 0).v).toBe(1234.56789);
    expect(cell(0, 1).v).toBe(0.12345);
    expect(cell(0, 1).s.fmt).toBe('percent');
    expect(cell(0, 2).v).toBe(42);
    expect(cell(0, 3).v).toBe(7);
  });

  it('keeps a string Excel marks with x:str even when it looks like a number', () => {
    const { cell } = pasted('<table><tr><td x:str>00123</td><td x:str="TRUE">TRUE</td></tr></table>');
    expect(cell(0, 0)).toEqual({ v: '00123', f: null, s: undefined });
    expect(cell(0, 1).v).toBe('TRUE');
  });

  it('reads the typed value Google Sheets carries in data-sheets-value', () => {
    const { cell } = pasted(`<table><tr>
      <td data-sheets-value='{"1":3,"3":0.12345}'>12.3%</td>
      <td data-sheets-value='{"1":2,"2":"007"}'>007</td>
      <td data-sheets-value='{"1":4,"4":true}'>TRUE</td>
      <td data-sheets-value='{"1":3,"3":"1e400"}'>1</td>
      <td data-sheets-value='{bad'>2</td>
      <td data-sheets-value='[3]'>3</td>
    </tr></table>`);
    expect(cell(0, 0).v).toBe(0.12345);
    expect(cell(0, 0).s.fmt).toBe('percent');
    expect(cell(0, 1).v).toBe('007');
    expect(cell(0, 2).v).toBe(true);
    expect([3, 4, 5].map((c) => cell(0, c).v)).toEqual([1, 2, 3]);
  });

  it('reads Excel number formats from mso-number-format, escaped or named, as a file\'s would be', () => {
    const { cell, wb, id } = pasted(`<html><head><style>
      .xl65 {mso-number-format:"0\\.00";} .xl66 {mso-number-format:"\\#\\,\\#\\#0\\.00";} .xl67 {mso-number-format:"0%";}
      .xl68 {mso-number-format:"\\0022$\\0022\\#\\,\\#\\#0\\.00";} .xl69 {mso-number-format:Percent;} .xl70 {mso-number-format:"Short Date";}
      .xl71 {mso-number-format:"m\\/d\\/yyyy";} .xl72 {mso-number-format:"\\#\\ ?\\/?";} .xl73 {mso-number-format:General;}
    </style></head><body><table><tr>
      <td class=xl65 x:num="2">2.00</td><td class=xl66 x:num="1234.5">1,234.50</td><td class=xl67 x:num="0.5">50%</td>
      <td class=xl68 x:num="1234.5">$1,234.50</td><td class=xl69 x:num="0.25">25.00%</td><td class=xl70 x:num="45658">1/2/2025</td>
      <td class=xl71 x:num="45658">1/2/2025</td><td class=xl72 x:num="0.5"> 1/2</td><td class=xl73 x:num="7">7</td>
    </tr></table></body></html>`);
    expect(cell(0, 0)).toEqual({ v: 2, f: null, s: { fmt: 'number', dec: 2, group: false } });
    expect(cell(0, 1)).toEqual({ v: 1234.5, f: null, s: { fmt: 'number', dec: 2, group: true } });
    expect(cell(0, 2)).toEqual({ v: 0.5, f: null, s: { fmt: 'percent', dec: 0, group: false } });
    expect(cell(0, 3)).toMatchObject({ v: 1234.5, s: { fmt: 'currency', cur: 'USD', dec: 2 } });
    expect(cell(0, 4)).toEqual({ v: 0.25, f: null, s: { fmt: 'percent', dec: 2, group: false } });
    expect(wb.getDisplay(id, 0, 4)).toBe('25.00%');
    expect(cell(0, 5)).toEqual({ v: 45658, f: null, s: { fmt: 'date' } });
    expect(cell(0, 6)).toEqual({ v: 45658, f: null, s: { fmt: 'custom', code: 'm/d/yyyy' } });
    expect(cell(0, 7)).toEqual({ v: 0.5, f: null, s: { fmt: 'custom', code: '# ?/?' } });
    expect(wb.getDisplay(id, 0, 7)).toBe(' 1/2');
    expect(cell(0, 8)).toEqual({ v: 7, f: null });
  });

  it('does not turn a typed number into a date because its text read as one', () => {
    const { cell } = pasted(`<table><tr><td x:num="0.5"> 1/2</td><td data-sheets-value='{"1":3,"3":0.75}'> 3/4</td>
      <td x:num="45658">1/2/2025</td><td x:num="45658.75">1/2/2025</td><td x:num="0.0004">0.0%</td></tr></table>`);
    expect(cell(0, 0)).toEqual({ v: 0.5, f: null });
    expect(cell(0, 1)).toEqual({ v: 0.75, f: null });
    expect(cell(0, 2).s.fmt).toBe('date'); // the text is that date
    expect(cell(0, 3).s.fmt).toBe('date'); // shown as a date, with a time of day behind it
    expect(cell(0, 4)).toMatchObject({ v: 0.0004, s: { fmt: 'percent' } });
  });

  it('keeps the destination cell format around a typed value', () => {
    const { cell } = pasted('<table><tr><td x:num="1234.56789">1,234.6</td></tr></table>', { fmt: 'currency', cur: 'EUR', bold: true });
    expect(cell(0, 0).v).toBe(1234.56789);
    expect(cell(0, 0).s).toMatchObject({ fmt: 'currency', cur: 'EUR', bold: true });
  });
});
