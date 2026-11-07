// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

it.each([1, 2])('copies Version %i results externally and calculates formulas using the destination internally', version => {
  const wb = new Workbook({ calculationCompatibility: { version }, sheets: [{ cells: {
    '0,0': { v: '😀x' }, '0,1': { f: 'LEN(A1)' }, '0,2': { f: 'SEARCH("x",A1)' },
  } }] });
  const range = { r1: 0, c1: 0, r2: 0, c2: 2 }, n = version === 1 ? 3 : 2;
  const values = wb.rangeValues(wb.activeSheetId, range), cells = wb.copyRange(wb.activeSheetId, range);
  const html = cellsToHtml(values.map(row => row.map(String)), cells, null, values);
  const internal = parseHtmlClipboard(html), destination = new Workbook({ calculationCompatibility: { version: version === 1 ? 2 : 1 } });
  destination.pasteCells(destination.activeSheetId, internal.cells, 2, 0, { r: 0, c: 0 });
  expect(destination.getCell(destination.activeSheetId, 2, 1).f).toBe('LEN(A3)');
  expect(destination.getValue(destination.activeSheetId, 2, 1)).toBe(version === 1 ? 2 : 3);
  const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(cellsFromHtmlRows(parseHtmlClipboard(external).rows).map(({ cell }) => cell.v)).toEqual(['😀x', n, n]);
  const excel = '<table xmlns:x="urn:schemas-microsoft-com:office:excel"><tr><td>😀x</td><td x:num="3">3</td><td x:num="3">3</td></tr></table>';
  const incoming = cellsFromHtmlRows(parseHtmlClipboard(excel).rows);
  expect(incoming.map(({ cell }) => cell.v)).toEqual(['😀x', 3, 3]);
  expect(incoming.every(({ cell }) => !cell.f)).toBe(true);
});
