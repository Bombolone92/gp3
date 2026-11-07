// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

// Cells copied in one tab and pasted in another travel as HTML. Without the
// block's origin the paste could not shift relative references, so a pasted
// =A1*2 kept pointing at A1 wherever it landed.
describe('embedded clipboard cells from another tab', () => {
  it('carry where they were copied from', () => {
    const cells = [[{ f: 'A1*2' }]];
    const html = cellsToHtml([['4']], cells, null, null, { r: 1, c: 0 });
    expect(html).toContain('data-spreadsheet-origin="1,0"');
    expect(parseHtmlClipboard(html)).toEqual({ cells, origin: { r: 1, c: 0 } });
    // A malformed origin is ignored rather than trusted.
    expect(parseHtmlClipboard(html.replace('1,0', 'x,y'))).toEqual({ cells });
    expect(parseHtmlClipboard(cellsToHtml([['4']], cells))).toEqual({ cells });
  });

  it('shift their relative references on paste like an in-app paste', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '2');
    wb.setInput(id, 0, 4, '3');
    const parsed = parseHtmlClipboard(cellsToHtml([['4']], [[{ f: 'A1*2' }]], null, null, { r: 1, c: 0 }));
    wb.pasteCells(id, parsed.cells, 5, 3, parsed.origin);
    expect(wb.getCell(id, 5, 3).f).toBe('D5*2');
    wb.pasteCells(id, parsed.cells, 1, 4, parsed.origin);
    expect(wb.getCell(id, 1, 4).f).toBe('E1*2');
    expect(wb.getValue(id, 1, 4)).toBe(6);
  });
});
