// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';

function pasted(html) {
  const parsed = parseHtmlClipboard(html);
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  return { wb, id, parsed };
}

describe('links in pasted HTML', () => {
  it('attaches links to pasted text without turning the value into a formula', () => {
    const { wb, id, parsed } = pasted('<table><tr><td><a href="https://example.com/x?a=1&amp;b=2">Example</a></td><td> <a href="mailto:ann@example.com"><b>Ann</b></a> </td><td><a href="www.example.org">www.example.org</a></td></tr></table>');
    expect(parsed.rows[0][0].text).toBe('Example'); // the text still drives values-only and arithmetic pastes
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 'Example', f: null, hyperlink: 'https://example.com/x?a=1&b=2' });
    expect(wb.getDisplay(id, 0, 0)).toBe('Example');
    expect(wb.linkAt(id, 0, 0)).toEqual({ url: 'https://example.com/x?a=1&b=2', label: 'Example' });
    expect(wb.linkAt(id, 0, 1)).toEqual({ url: 'mailto:ann@example.com', label: 'Ann' });
    expect(wb.getCell(id, 0, 1).s).toEqual({ bold: true });
    expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'www.example.org', f: null, hyperlink: 'https://www.example.org' });
    const bare = pasted('<table><tr><td><a href="https://example.com/x">https://example.com/x</a></td></tr></table>');
    expect(bare.wb.getCell(bare.id, 0, 0)).toMatchObject({ v: 'https://example.com/x', f: null, hyperlink: 'https://example.com/x' });
    expect(bare.wb.getDisplay(bare.id, 0, 0)).toBe('https://example.com/x');
  });

  it('preserves quotes inside the address and the label', () => {
    const { wb, id } = pasted('<table><tr><td><a href="https://example.com/?q=%22x%22">Say "hi"</a></td></tr></table>');
    expect(wb.getDisplay(id, 0, 0)).toBe('Say "hi"');
    expect(wb.linkAt(id, 0, 0).url).toBe('https://example.com/?q=%22x%22');
  });

  it('pastes only the text for unsafe or in-page addresses and for links that are part of a longer text', () => {
    const { wb, id } = pasted(`<table><tr>
      <td><a href="javascript:alert(1)">Click</a></td>
      <td><a href="data:text/html,hi">Data</a></td>
      <td><a href="#top">Top</a></td>
      <td>See <a href="https://example.com">the site</a> for details</td>
      <td><a href="https://example.com/a">One</a> <a href="https://example.com/b">Two</a></td>
      <td><a>No address</a></td>
    </tr></table>`);
    for (let c = 0; c < 6; c++) {
      expect(wb.getCell(id, 0, c).f, `column ${c}`).toBeNull();
      expect(wb.linkAt(id, 0, c), `column ${c}`).toBeNull();
    }
    expect([0, 1, 2, 3, 4, 5].map((c) => wb.getValue(id, 0, c))).toEqual(['Click', 'Data', 'Top', 'See the site for details', 'One Two', 'No address']);
  });

  it('leaves a linked cell that reads as a number or a date as a link too', () => {
    const { wb, id } = pasted('<table><tr><td><a href="https://example.com/1">12</a></td></tr></table>');
    expect(wb.getDisplay(id, 0, 0)).toBe('12');
    expect(wb.linkAt(id, 0, 0).url).toBe('https://example.com/1');
  });
});
