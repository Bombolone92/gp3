// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

// Number-format declarations and displayed cells as desktop Excel writes them
// for the same value at zero, one, two and three decimal places. The native
// HTML contains displayed text only here; it cannot recover hidden precision.
const native = String.raw`<style>
  .zero {mso-number-format:0%;} .one {mso-number-format:"0\.0%";}
  .two {mso-number-format:Percent;} .three {mso-number-format:"0\.000%";}
</style><table><tr><td class=zero>13%</td><td class=one>12.5%</td>
<td class=two>12.50%</td><td class=three>12.500%</td></tr></table>`;
const expected = ['13%', '12.5%', '12.50%', '12.500%'];
function paste(html) {
  const wb = new Workbook();
  wb.setCells(wb.activeSheetId, cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  return wb;
}
const displays = wb => [0, 1, 2, 3].map(c => wb.getDisplay(wb.activeSheetId, 0, c));

it('matches native Excel percentage precision without changing explicit format codes', () => {
  const wb = paste(native);
  expect(displays(wb)).toEqual(expected);
  expect([0, 1, 2, 3].map(c => wb.styleAt(wb.activeSheetId, 0, c).dec)).toEqual([0, 1, 2, 3]);
});

it.each(['Percent', '"percent"', "'PERCENT'"])('reads the %s alias independently of visible digits and preserves typed values', alias => {
  const values = [0, -0.035, 0.125, 12.345678];
  const wb = paste(`<table><tr>${values.map(v => `<td style="mso-number-format:${alias.replaceAll('"', '&quot;')}" x:num="${v}">####</td>`).join('')}</tr></table>`);
  expect([0, 1, 2, 3].map(c => wb.getValue(wb.activeSheetId, 0, c))).toEqual(values);
  expect(displays(wb)).toEqual(['0.00%', '-3.50%', '12.50%', '1234.57%']);
});

it('pastes the named percentage format over inherited currency while retaining the formula and undo', () => {
  const wb = new Workbook({ sheets: [{ name: 'Target', colStyles: { 2: { fmt: 'currency', cur: 'EUR', dec: 4 } }, cells: { '3,2': { f: '1/8' } } }] });
  const before = wb.toJSON(), style = parseHtmlClipboard(native).rows[0][2].style;
  wb.pasteStyles(wb.activeSheetId, [[{ s: style }]], 3, 2);
  expect(wb.getCell(wb.activeSheetId, 3, 2).f).toBe('1/8');
  expect(wb.getDisplay(wb.activeSheetId, 3, 2)).toBe('12.50%');
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});

it.each([false, true])('preserves native percentage precision in copied HTML, foreign=%s', foreign => {
  const wb = paste(native), cells = wb.copyRange(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 3 });
  let html = cellsToHtml([expected], cells);
  if (foreign) html = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html), back = new Workbook();
  if (parsed.cells) back.pasteCells(back.activeSheetId, parsed.cells, 0, 0);
  else back.setCells(back.activeSheetId, cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  expect(displays(back)).toEqual(expected);
});

it('keeps the precision through repeated native-only XLSX saves', async () => {
  let wb = paste(native);
  for (let save = 0; save < 2; save++) {
    const blob = await workbookToXlsx(wb);
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = reject; reader.readAsArrayBuffer(blob);
    });
    const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'percent.xlsx');
    expect(displays(wb)).toEqual(expected);
  }
});
