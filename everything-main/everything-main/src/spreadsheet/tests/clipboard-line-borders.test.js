// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

const edge = { bs: 'double', bc: '#8932ab' };
function copied() {
  const wb = new Workbook({ sheets: [{ name: 'Lines', colStyles: { 3: { bt: true, btBorder: edge, br: true, brBorder: { bs: 'medium', bc: '#219876' } } },
    rowStyles: { 8: { bl: true, bb: true, bs: 'dashed', bc: '#ab7643' } }, cells: { '2,3': { f: '3*5' } } }] });
  return { wb, cells: [wb.copyRange(wb.activeSheetId, { r1: 2, c1: 3, r2: 2, c2: 3 })[0],
    wb.copyRange(wb.activeSheetId, { r1: 8, c1: 6, r2: 8, c2: 6 })[0]] };
}
it('preserves inherited border descriptors and formulas in a private clipboard snapshot', () => {
  const { wb, cells } = copied();
  const parsed = parseHtmlClipboard(cellsToHtml([['15'], ['']], cells));
  expect(parsed.cells).toEqual(cells);
  expect(parsed.cells[0][0].f).toBe('3*5');
  parsed.cells[0][0].s.btBorder.bc = '#ffffff';
  expect(wb.styleAt(wb.activeSheetId, 2, 3).btBorder).toEqual(edge);
});
it('transfers row and column border appearance through external HTML and format-only paste', () => {
  const { wb, cells } = copied();
  const html = cellsToHtml([['15'], ['']], cells).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html);
  expect(parsed.cells).toBeUndefined();
  expect(parsed.rows[0][0].style.btBorder).toEqual(edge);
  expect(parsed.rows[0][0].style.brBorder).toEqual({ bs: 'medium', bc: '#219876' });
  expect(parsed.rows[1][0].style.blBorder).toEqual({ bs: 'dashed', bc: '#ab7643' });
  const foreign = cellsFromHtmlRows(parsed.rows).map(({ cell }) => [cell]);
  wb.setInput(wb.activeSheetId, 20, 8, '=7*8');
  wb.pasteStyles(wb.activeSheetId, foreign, 20, 8);
  expect(wb.getValue(wb.activeSheetId, 20, 8)).toBe(56);
  expect(wb.styleAt(wb.activeSheetId, 20, 8).btBorder).toEqual(edge);
  expect(wb.styleAt(wb.activeSheetId, 21, 8).bbBorder).toEqual({ bs: 'dashed', bc: '#ab7643' });
});
