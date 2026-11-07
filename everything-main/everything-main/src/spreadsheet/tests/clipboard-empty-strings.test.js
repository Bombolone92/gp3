// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { cellsFromHtmlRows, cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const office = body => `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><body>${body}</body></html>`;
const table = attrs => `<table><tr><td ${attrs} style="background-color:#ffeecc"><b>001</b><i>23</i></td></tr></table>`;
const cells = (html, plain) => cellsFromHtmlRows(parseHtmlClipboard(html, plain).rows).map(x => x.cell);

it('distinguishes native explicit empty strings from bare Office text markers', () => {
  // Actual Chrome clipboard -> Excel for Mac -> saved XLSX, 2026-09-21.
  for (const attr of ['x:str=""', "x:str=''", 'X:STR \n = \t ""']) {
    const cell = cells(office(table(attr)))[0];
    expect(cell, attr).toMatchObject({ v: '', f: null, s: { bg: '#ffeecc', bold: true } });
    expect(cell.richText).toBeUndefined();
  }
  const bare = cells(office(table('x:str')))[0];
  expect(bare.v).toBe('00123');
  expect(bare.richText.map(r => r.text)).toEqual(['001', '23']);
  expect(cells(office(table('x:str="stored"')))[0]).toMatchObject({ v: 'stored', s: { bold: true } });
});

it('keeps explicit empty values when the companion TSV contains display text', () => {
  const html = office('<table><tr><td x:str=""><b>label</b></td><td x:str>00123</td></tr></table>');
  expect(cells(html, 'other label\t00456').map(c => c.v)).toEqual(['', '00456']);
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows, null, { values: true }).map(x => x.cell.v)).toEqual(['', '00123']);
});

it('preserves empty-string semantics through edit, undo, XLSX and outgoing HTML', async () => {
  const wb = new Workbook(); const id = wb.activeSheetId;
  wb.setCells(id, cellsFromHtmlRows(parseHtmlClipboard(office(table('x:str=""'))).rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  wb.setCells(id, [{ r: 0, c: 1, cell: { f: 'ISBLANK(A1)' } }, { r: 0, c: 2, cell: { f: 'COUNTA(A1)' } }]);
  expect(wb.getValue(id, 0, 1)).toBe(false);
  expect(wb.getValue(id, 0, 2)).toBe(1);
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'edited' } }]); wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe('');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'roundtrip');
  expect(back.getCell(back.activeSheetId, 0, 0).v).toBe('');
  const cell = wb.getCell(id, 0, 0);
  const html = cellsToHtml([['']], [[cell]], null, [['']]);
  expect(parseHtmlClipboard(html).cells[0][0].v).toBe('');
  expect(cells(html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, ''))[0].v).toBe('');
});

it('associates the source attribute with cells after table repair and merge expansion', () => {
  const html = '<table><td x:str="" rowspan="2" colspan="2">label<td x:str>001<tr><td x:str="">second';
  const parsed = parseHtmlClipboard(html);
  expect(parsed.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
  expect(cellsFromHtmlRows(parsed.rows).map(x => x.cell?.v ?? null)).toEqual(['', null, '001', null, null, '']);
});

it('keeps source offsets stable across Unicode case expansion and surrogate pairs', () => {
  const html = '<p>İ😀雪</p><table><tr><td title="İ > 😀" X:STR="">İ😀visible</td><td x:str>İ0042😀</td></tr></table>';
  expect(cells(html).map(c => c.v)).toEqual(['', 'İ0042😀']);
});

it('does not confuse attribute contents, comments, or raw-text elements with cells', () => {
  for (const prefix of [
    '<!-- <td x:str=""> -->', '<!-->','<!--->', '<!-- <td x:str=""> --!>',
    '<!bogus <td x:str="">', '<?bogus <td x:str="">',
    '<script>const x = \'<td x:str="">\';</script>',
    '<style>.cell::before {content:\'<td x:str="">\'}</style>',
    '<textarea><td x:str="">literal</textarea>', '<title><td x:str="">literal</title>',
  ]) {
    const html = prefix + '<table title="<td x:str=\'\'>"><tr><td title=\'before > x:str=""\' x:str>0042</td><td x:str="">visible</td></tr></table>';
    expect(cells(html).map(c => c.v), prefix).toEqual(['0042', '']);
  }
});

it('preserves ordinary HTML duplicate-attribute precedence and quoted/unquoted token boundaries', () => {
  // Duplicate attributes are malformed HTML: use the browser's first value.
  for (const [attrs, expected] of [['x:str x:str=""', '00123'], ['x:str="" x:str', ''], ['x:str="stored" x:str=""', 'stored'],
    ['title=unquoted" x:str=""', ''], ['title="x:str=\'\' >" x:str', '00123'], ['x:str=stored/>', 'stored/']]) {
    const html = attrs.endsWith('>') ? `<table><tr><td ${attrs}00123</td></tr></table>` : table(attrs);
    expect(cells(html)[0].v, attrs).toBe(expected);
  }
});

it('removes temporary syntax markers and preserves incoming attributes and styles', () => {
  const parser = vi.spyOn(DOMParser.prototype, 'parseFromString');
  try {
    const html = '<style>td {color:#123456} .original {background-color:#abcdef}</style>'
      + '<table><tr><td class="original" data-office-empty-string x:str="">one</td><td x:str="">two</td><td x:str>three</td></tr></table>';
    const result = cells(html);
    expect(result.map(c => c.v)).toEqual(['', '', 'three']);
    expect(result[0].s).toMatchObject({ bg: '#abcdef', color: '#123456' });
    expect(result[1].s).toMatchObject({ color: '#123456' });
    expect(result[1].s.bg).toBeUndefined();
    expect(parser).toHaveBeenCalledTimes(1);
    const doc = parser.mock.results.at(-1).value;
    expect([...doc.querySelectorAll('td')].map(td => td.getAttributeNames())).toEqual([
      ['class', 'data-office-empty-string', 'x:str'], ['x:str'], ['x:str'],
    ]);
  } finally { parser.mockRestore(); }
});

it('leaves untyped empty cells blank and typed empty strings stored', () => {
  const html = '<table><tr><td></td><td x:str=""></td><td data-sheets-value=\'{"1":2,"2":""}\'></td></tr></table>';
  expect(cells(html).map(c => c?.v ?? null)).toEqual([null, '', '']);
  const native = office('<style>td {text-align:general}</style><table><tr><td>&nbsp;</td><td x:str=""></td><td x:str></td></tr></table>');
  // Native controls also store an empty string for empty markup with bare x:str.
  for (const plain of [undefined, '\t\t']) expect(cells(native, plain).map(c => c?.v ?? null)).toEqual([null, '', '']);
});
