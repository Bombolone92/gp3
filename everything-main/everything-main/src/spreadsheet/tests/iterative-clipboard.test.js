// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

it('copies circular formulas internally and exchanges their calculated values through Excel HTML', () => {
  const wb = new Workbook({ iteration: { iterate: true, iterateDelta: 1e-10 }, sheets: [{ name: 'Model', cells: {
    '0,0': { f: '(A1+B1)/2', v: 4 }, '0,1': { v: 18 },
  } }] });
  const id = wb.activeSheetId, range = { r1: 0, c1: 0, r2: 0, c2: 1 };
  const values = wb.rangeValues(id, range);
  const cells = wb.copyRange(id, range);
  const html = cellsToHtml([values[0].map(String)], cells, null, values);
  const internal = parseHtmlClipboard(html);
  expect(internal.cells[0][0].f).toBe('(A1+B1)/2');
  expect(internal.cells[0][0].v).toBeCloseTo(18, 8);
  wb.pasteCells(id, internal.cells, 3, 2, { r: 0, c: 0 });
  expect(wb.getCell(id, 3, 2).f).toBe('(C4+D4)/2');
  expect(wb.getValue(id, 3, 2)).toBeCloseTo(18, 8);
  // Foreign programs consume standard HTML typed values. Workbook iteration
  // settings do not travel on the clipboard or silently enable in a destination.
  const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows);
  expect(pasted[0].cell.f).toBeNull();
  expect(pasted[0].cell.v).toBeCloseTo(18, 8);
  const excel = '<table xmlns:x="urn:schemas-microsoft-com:office:excel"><tr><td x:num="12.75">12.75</td></tr></table>';
  expect(cellsFromHtmlRows(parseHtmlClipboard(excel).rows)[0].cell.v).toBe(12.75);
});
