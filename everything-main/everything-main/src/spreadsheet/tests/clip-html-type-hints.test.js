// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';

// The HTML this app writes carries each cell's type and number format in the
// attributes Excel reads, so Excel, Sheets, and this app in another tab keep text
// like 00123 as text and numbers at full precision, even when the block is
// too large for the embedded cells.
function rowsPaste(html, r0 = 0) {
  const parsed = parseHtmlClipboard(html);
  const wb = new Workbook();
  const id = wb.activeSheetId;
  // Clipped at the grid's edge before writing, as the editor clips a pasted table: a cell past the last row has nowhere to go.
  const entries = cellsFromHtmlRows(parsed.rows, (i, j) => wb.getCell(id, i, j)?.s).map(({ i, j, cell }) => ({ r: r0 + i, c: j, cell }));
  wb.setCells(id, entries.filter(({ r, c }) => r < MAX_ROWS && c < MAX_COLS));
  return { parsed, cell: (r, c) => wb.getCell(id, r, c) };
}

describe('type hints in copied HTML', () => {
  it('writes x:num, x:str and the number format on each cell', () => {
    const cells = [[{ v: '00123', s: { fmt: 'text' } }, { v: 1234.5678, s: { fmt: 'number', dec: 2 } }, { v: 0.5, s: { fmt: 'percent', dec: 0 } }, { v: 'plain' }, { v: 7 }, null]];
    const html = cellsToHtml([['00123', '1,234.57', '50%', 'plain', '7', '']], cells, null, [['00123', 1234.5678, 0.5, 'plain', 7, null]]);
    const tds = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('td')];
    expect(tds[0].getAttribute('x:str')).toBe('00123');
    expect(tds[0].getAttribute('style')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:"\\@"');
    expect(tds[1].getAttribute('x:num')).toBe('1234.5678');
    expect(tds[1].getAttribute('style')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:"\\#\\,\\#\\#0\\.00"');
    expect(tds[2].getAttribute('x:num')).toBe('0.5');
    expect(tds[2].getAttribute('style')).toBe('vertical-align:middle;white-space:nowrap;mso-number-format:"\\#\\,\\#\\#0\\%"');
    expect(tds[3].getAttribute('x:str')).toBe('plain');
    expect(tds[4].getAttribute('x:num')).toBe('7');
    expect(tds[4].style.whiteSpace).toBe('nowrap');
    expect(tds[5].style.whiteSpace).toBe('nowrap');
    expect(tds[5].hasAttribute('x:num')).toBe(false);
  });

  it('names the text itself in x:str when the display reads differently, and reads it back', () => {
    const html = cellsToHtml([['a  b']], [[{ v: '  a  b' }]], null, [['  a  b']]);
    expect(new DOMParser().parseFromString(html, 'text/html').querySelector('td').getAttribute('x:str')).toBe('  a  b');
    const external = html.replace(/ data-spreadsheet-(cells|values)="[^"]*"/g, '');
    expect(parseHtmlClipboard(external).rows[0][0].text).toBe('a  b');
    const { cell } = rowsPaste(external);
    expect(cell(0, 0)).toEqual({ v: '  a  b', f: null, s: { wrap: false, valign: 'middle' } });
    expect(rowsPaste('<table><tr><td x:str="  lead">lead</td><td x:str>00123</td></tr></table>').cell(0, 0).v).toBe('  lead');
  });

  it('round-trips text and formatted numbers through the markup alone', () => {
    const cells = [[{ v: '00123', s: { fmt: 'text' } }, { v: 1234.5678, s: { fmt: 'number', dec: 2 } }, { v: 0.5, s: { fmt: 'percent', dec: 0 } }, { v: 1500, s: { fmt: 'currency', cur: 'EUR' } }]];
    const html = cellsToHtml([['00123', '1,234.57', '50%', '€1,500.00']], cells, null, [['00123', 1234.5678, 0.5, 1500]]);
    const { parsed, cell } = rowsPaste(html.replace(/ data-spreadsheet-(cells|values)="[^"]*"/g, ''));
    expect(parsed.cells).toBeUndefined();
    expect(cell(0, 0)).toEqual({ v: '00123', f: null, s: { fmt: 'text', wrap: false, valign: 'middle' } });
    expect(cell(0, 1)).toEqual({ v: 1234.5678, f: null, s: { fmt: 'number', dec: 2, group: true, wrap: false, valign: 'middle' } });
    expect(cell(0, 2)).toEqual({ v: 0.5, f: null, s: { fmt: 'percent', dec: 0, wrap: false, valign: 'middle' } });
    expect(cell(0, 3)).toMatchObject({ v: 1500, s: { fmt: 'currency', cur: 'EUR', dec: 2 } });
  });

  it('keeps text and precision across tabs for a block too large to embed its cells', () => {
    const values = Array.from({ length: 5001 }, (_, i) => (i ? [1.23456] : ['00123']));
    const cells = values.map(([v]) => [typeof v === 'string' ? { v, s: { fmt: 'text' } } : { v, s: { fmt: 'number', dec: 2 } }]);
    const html = cellsToHtml(values.map(([v]) => [typeof v === 'string' ? v : '1.23']), cells, null, values);
    const { parsed, cell } = rowsPaste(html);
    expect(parsed.cells).toBeUndefined();
    expect(parsed.values).toHaveLength(5001);
    expect(cell(0, 0)).toEqual({ v: '00123', f: null, s: { fmt: 'text', wrap: false, valign: 'middle' } });
    expect(cell(1, 0)).toMatchObject({ v: 1.23456, s: { fmt: 'number', dec: 2 } });
  });

  it('keeps external type hints on large blocks while bounding per-cell number formats', () => {
    const values = Array.from({ length: 20001 }, (_, i) => (i ? [i] : ['00123']));
    const cells = values.map(([v]) => (typeof v === 'string' ? [{ v, s: { fmt: 'text' } }] : [{ v, s: { fmt: 'number', dec: 2 } }]));
    const html = cellsToHtml(values.map(([v]) => [String(v)]), cells, null, values);
    expect(html.includes('x:str="00123"')).toBe(true);
    expect(html).not.toContain('mso-number-format');
    // Pasted 20,000 rows above the grid's last row, the block runs a row past it.
    const r0 = MAX_ROWS - 20000;
    const { cell } = rowsPaste(html, r0);
    expect(cell(r0, 0)).toEqual({ v: '00123', f: null, s: { wrap: false, valign: 'middle' } });
    // Its last row of the grid is typed from the snapshot, the row past it is cut off.
    expect(cell(MAX_ROWS - 1, 0)).toEqual({ v: 19999, f: null, s: { wrap: false, valign: 'middle' } });
    expect(cell(MAX_ROWS, 0)).toBeUndefined();
  });
});
