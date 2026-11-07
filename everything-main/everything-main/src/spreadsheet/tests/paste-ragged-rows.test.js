// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';

// A short row in a pasted table must still clear the destination cells under
// the table's full width, or stale data sits inside the highlighted paste block.
it('pads every short row to the table width so the paste clears the whole block', () => {
  const parsed = parseHtmlClipboard('<table><tr><td>A</td><td>B</td><td>C</td></tr><tr><td>D</td></tr><tr><td>E</td><td>F</td></tr></table>');
  expect(parsed.rows.map((row) => row.map((cell) => cell.text))).toEqual([['A', 'B', 'C'], ['D', '', ''], ['E', 'F', '']]);
  expect(parsed.rows[1][2]).toEqual({ text: '', style: undefined });
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, `old${r}${c}`);
  wb.setCells(id, cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  expect([0, 1, 2].map((r) => [0, 1, 2].map((c) => wb.getValue(id, r, c)))).toEqual([['A', 'B', 'C'], ['D', null, null], ['E', 'F', null]]);
});

it('pads rows that end under a row span as well', () => {
  const parsed = parseHtmlClipboard('<table><tr><td rowspan="2">G</td><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>');
  expect(parsed.rows.map((row) => row.map((cell) => cell.text))).toEqual([['G', '1', '2'], ['', '3', '']]);
});
