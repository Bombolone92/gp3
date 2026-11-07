// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsFromHtmlRows, cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const parse = html => cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({ cell }) => cell);
const table = body => `<table><tr>${body}</tr></table>`;

// HTML-only pastes into native Excel, saved and checked in worksheet/style XML.
// General stays automatic; the unsupported CSS auto keyword falls back to align.
it.each([
  ['style="text-align:left"', 'left'],
  ['style="text-align:center"', 'center'],
  ['style="text-align:right"', 'right'],
  ['style="text-align:LEFT"', 'left'],
  ['style="text-align:CENTER"', 'center'],
  ['style="text-align:RIGHT"', 'right'],
  ['align=left', 'left'],
  ['align=center', 'center'],
  ['align=right', 'right'],
  ['align=LEFT', 'left'],
  ['align=CENTER', 'center'],
  ['align=RIGHT', 'right'],
  ['style="text-align:general" align=center', undefined],
  ['style="text-align:auto" align=center', 'center'],
  ['style="text-align:left" align=right', 'left'],
  ['style="text-align:right" align=left', 'right'],
])('retains native horizontal placement for %s', (attributes, expected) => {
  const [cell] = parse(table(`<td ${attributes} x:num="123">123</td>`));
  expect(cell.v).toBe(123);
  expect(cell.s?.align).toBe(expected);
});

it('preserves explicit placement independently of number, Boolean, error and text types', () => {
  for (const align of ['left', 'center', 'right']) {
    const cells = parse(table([
      '<td x:num="42">42</td>', '<td x:bool="TRUE">TRUE</td>',
      '<td>#N/A</td>', '<td x:str="007">007</td>',
    ].join('').replaceAll('<td', `<td style="text-align:${align}"`)));
    expect(cells.map(c => c.v)).toEqual([42, true, { error: '#N/A' }, '007']);
    expect(cells.map(c => c.s?.align)).toEqual(Array(4).fill(align));
  }
});

it('retains inherited and cascaded alignment, including explicit left overrides', () => {
  const cells = parse(`<style>table{text-align:right}td{text-align:inherit}
    .left{text-align:LEFT!important}.auto{text-align:General}</style>
    <table><tr><td>1</td><td class=left style="text-align:center" align=right>2</td>
    <td class=auto align=center>label</td></tr></table>`);
  expect(cells.map(c => c.s?.align)).toEqual(['right', 'left', undefined]);
});

it('uses normalized alignment when interpreting indentation', () => {
  const cells = parse(table('<td style="text-align:RIGHT;padding-right:24px">1</td>'
    + '<td style="text-align:CENTER;mso-char-indent-count:2">2</td>'
    + '<td style="text-align:LEFT;padding-left:36px">3</td>'));
  expect(cells.map(c => c.s?.indent)).toEqual([2, undefined, 3]);
});

it('preserves alignment through edit/undo, outgoing HTML and metadata-free XLSX', async () => {
  const aligns = ['left', 'center', 'right'];
  const cells = parse(table(aligns.map(align => `<td style="text-align:${align}" x:num="12.5">12.5</td>`).join('')));
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, cells.map((cell, c) => ({ r: 0, c, cell })));
  wb.setInput(id, 0, 0, '28');
  expect(wb.styleAt(id, 0, 0).align).toBe('left');
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(12.5);
  const html = cellsToHtml([['12.5', '12.5', '12.5']], [cells], null, [[12.5, 12.5, 12.5]])
    .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(parse(html).map(c => c.s?.align)).toEqual(aligns);
  const blob = await workbookToXlsx(wb);
  const data = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(data, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content)
    .replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'alignment.xlsx');
  for (const [c, align] of aligns.entries()) {
    expect(back.getValue(back.activeSheetId, 0, c)).toBe(12.5);
    expect(back.styleAt(back.activeSheetId, 0, c).align).toBe(align);
  }
});
