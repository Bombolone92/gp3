// @vitest-environment jsdom
import { stampClipboardHtml } from './helpers/clipboard.js';
import { describe, it, expect } from 'vitest';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

const texts = (parsed) => parsed.rows.map((row) => row.map((cell) => cell.text));

describe('nested tables in pasted HTML', () => {
  it('reads the inner table when the outer one is only a wrapper around it', () => {
    const html = `<table width="100%"><tr><td align="center">
        <div><table><tr><th>Name</th><th>Qty</th></tr><tr><td>Ann</td><td>3</td></tr></table></div>
      </td></tr></table>`;
    expect(texts(parseHtmlClipboard(html))).toEqual([['Name', 'Qty'], ['Ann', '3']]);
    // Wrappers inside wrappers, as mail clients write them.
    expect(texts(parseHtmlClipboard(`<table><tbody><tr><td>${html}</td></tr></tbody></table>`))).toEqual([['Name', 'Qty'], ['Ann', '3']]);
  });

  it('still reads a wrapped table from this app with its cells intact', () => {
    const inner = stampClipboardHtml(`<table data-spreadsheet-cells='[[{"v":10,"s":{"bold":true}}]]'><tr><td>10</td></tr></table>`);
    expect(parseHtmlClipboard(`<table><tr><td>${inner}</td></tr></table>`).cells).toEqual([[{ v: 10, s: { bold: true } }]]);
  });

  it('keeps the outer table when the wrapping cell has text of its own or there are other cells', () => {
    const own = parseHtmlClipboard('<table><tr><td>Total<table><tr><td>1</td><td>2</td></tr></table></td></tr></table>');
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]).toHaveLength(1);
    const two = parseHtmlClipboard('<table><tr><td><table><tr><td>1</td></tr></table></td><td>x</td></tr></table>');
    expect(two.rows[0]).toHaveLength(2);
    expect(two.rows[0][1].text).toBe('x');
  });

  it('separates the cells and rows of a table inside a cell with tabs and newlines', () => {
    const parsed = parseHtmlClipboard(`<table><tr><td>Total<table>
        <tr><td>a</td><td>b</td></tr>
        <tr><td>c</td><td>d</td></tr>
      </table></td><td>x</td></tr></table>`);
    expect(parsed.rows[0][0].text).toBe('Total\na\tb\nc\td');
    expect(parsed.rows[0][1].text).toBe('x');
  });

  it('collapses ordinary whitespace and tabs in cell markup as before, and breaks lines at block edges', () => {
    const parsed = parseHtmlClipboard('<table><tr><td> \t Hello \t <b>big</b> \t world \t </td><td>Ann<br>Lee<div>Paris</div></td><td>\n  <p>a</p>\n  <p>b</p>\n</td></tr></table>');
    expect(parsed.rows[0].map((cell) => cell.text)).toEqual(['Hello big world', 'Ann\nLee\nParis', 'a\nb']);
  });
});
