// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, cellsFromHtmlRows, parseHtmlClipboard } from '../src/core/clipboard.js';

it('retains the original characters through private/foreign HTML while formulas compare space separators', () => {
  const values = ['a b', 'a\u00a0b', 'a\u2007b', 'a\u202fb', 'a\u3000b', 'a\tb', 'a\nb'];
  const html = cellsToHtml([values], [values.map(v => ({ v }))], null, [values]);
  for (const markup of [html, html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '')]) {
    const parsed = parseHtmlClipboard(markup);
    const cells = parsed.cells ? parsed.cells.flatMap((row, i) => row.map((cell, j) => ({ i, j, cell }))) : cellsFromHtmlRows(parsed.rows);
    expect(cells.map(x => x.cell.v)).toEqual(values);
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setCells(id, cells.map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    wb.setInput(id, 1, 0, '=COUNTIF(A1:G1,"a b")');
    expect(wb.getValue(id, 1, 0)).toBe(5);
    // Literal functions still distinguish the preserved characters after paste.
    wb.setInput(id, 1, 1, '=EXACT(A1,B1)');
    expect(wb.getValue(id, 1, 1)).toBe(false);
  }
});
