// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, copyMergeSpans, parseHtmlClipboard } from '../src/core/clipboard.js';
import { parseRange } from '../src/core/cell.js';

// The copied HTML wrote one <td> per copied cell and never looked at the sheet's merges, so a merged
// report title pasted into Word or Excel sat in one cell with stray empties beside it and the layout of
// any invoice or report header was lost. The reverse direction has always read colspan and rowspan.
describe('merges of a copied block', () => {
  it('give the block\'s first cell a colspan and a rowspan, and drop the cells they cover', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Quarterly report');
    wb.mergeCells(id, parseRange('A1:C1'));
    for (const [c, text] of ['a', 'b', 'c'].entries()) wb.setInput(id, 1, c, text);
    const range = parseRange('A1:C2');
    const { rows, cols } = wb.visibleIndices(id, range);
    const texts = rows.map((r) => cols.map((c) => wb.getDisplay(id, r, c)));
    const html = cellsToHtml(texts, wb.copyRange(id, range), null, null, null, { merges: wb.sheet(id).merges, rows, cols });
    const rowsInHtml = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('tr');
    expect(rowsInHtml[0].cells).toHaveLength(1);
    expect(rowsInHtml[0].cells[0].colSpan).toBe(3);
    expect(rowsInHtml[0].cells[0].textContent).toBe('Quarterly report');
    expect([...rowsInHtml[1].cells].map(td => td.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('span only the lines copied, skip a merge overlapping one already placed, and leave single cells alone', () => {
    // Rows 1 and 3 hidden, column 1 hidden: the merge over rows 0–3 and columns 0–2 spans 2 by 2.
    const spans = copyMergeSpans([
      { r1: 0, c1: 0, r2: 3, c2: 2 },
      { r1: 4, c1: 3, r2: 5, c2: 3 },
      { r1: 5, c1: 3, r2: 5, c2: 3 }, // overlaps the one before it
      { r1: 2, c1: 3, r2: 2, c2: 3 }, // one cell after clipping: no span
    ], [0, 2, 4, 5], [0, 2, 3]);
    expect(spans.get('0,0')).toEqual({ rowSpan: 2, colSpan: 2 });
    expect(spans.get('1,1')).toBeNull();
    expect(spans.get('2,2')).toEqual({ rowSpan: 2, colSpan: 1 });
    expect(spans.has('1,2')).toBe(false);
    expect(spans.size).toBe(6);
  });

  it('leaves the embedded cells a full rectangle, so an in-app paste is unchanged', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Title');
    wb.mergeCells(id, parseRange('A1:B1'));
    const range = parseRange('A1:B1');
    const { rows, cols } = wb.visibleIndices(id, range);
    const cells = wb.copyRange(id, range);
    const html = cellsToHtml([[wb.getDisplay(id, 0, 0), '']], cells, null, null, null, { merges: wb.sheet(id).merges, rows, cols });
    expect(parseHtmlClipboard(html)).toEqual({ cells, merges: [range] });
    // Read back as foreign markup, the span fills the rectangle out again.
    const plain = parseHtmlClipboard(html.replace(/ data-spreadsheet-cells="[^"]*"/, ''));
    expect(plain.rows[0].map((cell) => cell.text)).toEqual(['Title', '']);
  });

  it('writes no spans at all when the caller passes no merges, as before', () => {
    const html = cellsToHtml([['Title', '']], [[{ v: 'Title', f: null }, null]]);
    expect(html).not.toContain('colspan');
  });
});
