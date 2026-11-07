// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

// Standard HTML preserves the visible link even without embedded cells. The
// embedded form additionally retains formulas for an exact in-app copy.
const hrefs = (html) => [...html.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);

describe('copied cells carry their links', () => {
  it('writes a HYPERLINK formula and an address typed as text as <a href>', () => {
    const cells = [[
      { v: null, f: 'HYPERLINK("https://example.com/report","Q3 report")' },
      { v: 'https://example.com/plain', f: null },
      { v: 'sales@example.com', f: null },
      { v: 'Not a link', f: null },
    ]];
    const html = cellsToHtml([['Q3 report', 'https://example.com/plain', 'sales@example.com', 'Not a link']], cells);
    expect(hrefs(html)).toEqual([
      ['https://example.com/report', 'Q3 report'],
      ['https://example.com/plain', 'https://example.com/plain'],
      ['mailto:sales@example.com', 'sales@example.com'],
    ]);
  });

  it('writes no link for an address the app would not open, a workbook location, or a removed link', () => {
    const cells = [[
      { v: null, f: 'HYPERLINK("javascript:alert(1)","Click")' },
      { v: null, f: 'HYPERLINK("#Sheet2!A1","Go to Sheet2")' },
      { v: null, f: 'HYPERLINK(A1)' },
      { v: 'https://example.com/off', f: null, s: { nolink: true } },
    ]];
    expect(hrefs(cellsToHtml([['Click', 'Go to Sheet2', 'x', 'https://example.com/off']], cells))).toEqual([]);
  });

  it('escapes the address and keeps the cell\'s own markup inside the link', () => {
    // The address is written as the formula quotes it, "" standing for one quote, and every character
    // that would end the attribute or start a tag is escaped.
    const cells = [[{ v: null, f: 'HYPERLINK("https://example.com/?a=1&b=""2""","A & B")' }, { v: 'x\ny', f: null }]];
    const html = cellsToHtml([['A & B', 'x\ny']], cells);
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=&quot;2&quot;">A &amp; B</a>');
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    expect(cellsFromHtmlRows(parseHtmlClipboard(external).rows)[1].cell).toMatchObject({ v: 'x\ny', s: { wrap: false } });
  });

  it('brings the link back when the markup comes home without the embedded cells', () => {
    const cells = [[{ v: null, f: 'HYPERLINK("https://example.com/report","Q3 report")' }]];
    const html = cellsToHtml([['Q3 report']], cells).replace(/ data-spreadsheet-cells="[^"]*"/, '');
    const parsed = parseHtmlClipboard(html);
    expect(parsed.rows[0][0].link).toBe('https://example.com/report');
    expect(cellsFromHtmlRows(parsed.rows, null)[0].cell).toMatchObject({ v: 'Q3 report', f: null, hyperlink: 'https://example.com/report' });
    // Paste special → Values only still gives the text alone.
    expect(cellsFromHtmlRows(parsed.rows, null, { values: true })[0].cell.v).toBe('Q3 report');
  });

  it('leaves the embedded cells, and so an in-app paste, exactly as they were', () => {
    const cells = [[{ v: null, f: 'HYPERLINK("https://example.com/report","Q3 report")' }]];
    expect(parseHtmlClipboard(cellsToHtml([['Q3 report']], cells))).toEqual({ cells });
  });
});
