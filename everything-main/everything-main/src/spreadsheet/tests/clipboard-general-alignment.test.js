// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const parse = (body, css = 'td {text-align:general;mso-number-format:General}') =>
  cellsFromHtmlRows(parseHtmlClipboard(`<style>${css}</style><table><tr>${body}</tr></table>`).rows).map(x => x.cell);

// In clipboard HTML from Excel, General cells carry align=left/right/center
// according to type; manually aligned cells use CSS and carry no type hint.
it.each(['general', 'auto', 'GENERAL'])('preserves automatic-aligned text under Office %s alignment', alignment => {
  const values = ['00072', '1.50', '1E3', 'TRUE', 'FALSE', '#DIV/0!', '2/3/2027', '=SUM(A1:A3)', "'literal", '  padded  '];
  const cells = parse(values.map(v => `<td align="LEFT" style="white-space:pre-wrap">${v}</td>`).join(''), `td{text-align:${alignment};mso-number-format:General}`);
  expect(cells.map(c => c.v)).toEqual(values);
  expect(cells.every(c => c.f == null)).toBe(true);
  expect(cells.every(c => !c.s?.dateStyle)).toBe(true);
});

it('keeps numbers, Booleans and errors distinct from similarly displayed text', () => {
  const cells = parse('<td align=left>005</td><td align=right>5</td><td align=left>TRUE</td><td align=center>TRUE</td><td align=left>#N/A</td><td align=center>#N/A</td>');
  expect(cells.map(c => c.v)).toEqual(['005', 5, 'TRUE', true, '#N/A', { error: '#N/A' }]);
});

it('does not infer a type from explicit alignment or ordinary web-table placement', () => {
  const cells = parse('<td class=manual align=left>13</td><td style="text-align:right" align=left>17</td><td>19</td>', 'td{text-align:general}.manual{text-align:left}');
  expect(cells.map(c => c.v)).toEqual([13, 17, 19]);
  expect(parse('<td align=left>21</td>', '')[0].v).toBe(21);
});

it('uses the resolved CSS cascade, including inheritance, inline overrides and importance', () => {
  const cells = parse('<td align=left>0002</td><td class=manual align=left>4</td><td class=restore align=left>0006</td><td class=manual align=left style="text-align:general!important">0008</td>',
    'table{text-align:general}td{text-align:inherit}.manual{text-align:left!important}.restore{text-align:auto}');
  expect(cells.map(c => c.v)).toEqual(['0002', 4, '0006', '0008']);
});

it('prefers explicit typed values, including bare numeric markers, over automatic placement', () => {
  const cells = parse('<td align=left x:num="1.2345">1.23</td><td align=left x:num>7</td><td align=right x:str>008</td><td align=left data-sheets-value=\'{"1":3,"3":9}\'>9</td>');
  expect(cells.map(c => c.v)).toEqual([1.2345, 7, '008', 9]);
});

it('does not apply a left-to-right type hint in a right-to-left context', () => {
  for (const css of ['table{direction:rtl}td{text-align:general}', 'td{direction:RTL;text-align:auto}']) {
    expect(parse('<td align=left>12</td>', css)[0].v).toBe(12);
  }
  const rows = parseHtmlClipboard('<div dir=rtl><style>td{text-align:general}</style><table><tr><td align=left>14</td></tr></table></div>').rows;
  expect(cellsFromHtmlRows(rows)[0].cell.v).toBe(14);
});

it('retains text values through edits, undo, outgoing HTML and native XLSX without private metadata', async () => {
  const cells = parse('<td align=left>0091</td><td align=left>=1+2</td><td align=left>FALSE</td>');
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, cells.map((cell, c) => ({ r: 0, c, cell })));
  wb.setInput(id, 0, 0, '22'); wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe('0091');
  const html = cellsToHtml([cells.map(c => c.v)], [cells], null, [cells.map(c => c.v)]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x => x.cell.v)).toEqual(['0091', '=1+2', 'FALSE']);
  const blob = await workbookToXlsx(wb);
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect([0, 1, 2].map(c => back.getValue(back.activeSheetId, 0, c))).toEqual(['0091', '=1+2', 'FALSE']);
  expect(back.getCell(back.activeSheetId, 0, 1).f).toBeNull();
});
