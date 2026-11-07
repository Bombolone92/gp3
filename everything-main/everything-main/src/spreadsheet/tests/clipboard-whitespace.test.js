// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const parse = (content, css = '', attrs = '') => parseHtmlClipboard(`<style>${css}</style><table><tr><td ${attrs}>${content}</td></tr></table>`).rows[0][0];

it.each(['', 'normal', 'nowrap'])('collapses source whitespace under %s across inline nodes', mode => {
  for (const content of ['  Several\r\n  source\n\tlines ', '  Several<span>\r\n source</span>\n\tlines ', '<!--not text--> Several\nsource<!--nor this-->\nlines']) {
    expect(parse(content, `td {white-space:${mode}}`).text).toBe('Several source lines');
  }
  expect(parse('a<span> </span><b> b </b> c').text).toBe('a b c');
});

it.each(['pre', 'pre-wrap', 'break-spaces'])('preserves significant whitespace under %s, including inherited values', mode => {
  const raw = '  a\t b \n\n c  \n';
  expect(parse(raw, `table {white-space:${mode}}`).text).toBe(raw);
  expect(parse(`<span>${raw}</span>`, `td {white-space:${mode}}`).text).toBe(raw);
  expect(parse(raw, `td {white-space:${mode}}`).style.wrap).toBe(mode !== 'pre');
});

it('preserves source newlines but collapses line-edge spaces with pre-line', () => {
  const cell = parse('  one \t\r\n  two\n\nthree  \n', 'td {white-space:pre-line}');
  expect(cell.text).toBe('one\ntwo\n\nthree\n');
  expect(cell.style.wrap).toBe(true);
});

it.each([
  ['td {white-space:normal}', ''],
  ['table {white-space:normal}', ''],
  ['table {white-space:normal} td {white-space:inherit}', ''],
  ['table {white-space:normal} td {white-space:unset}', ''],
  ['td {white-space:nowrap}', 'style="white-space: NORMAL"'],
])('preserves explicitly declared normal wrapping without producer metadata: %s %s', (css, attrs) => {
  const cell = parse('  ordinary\n source text  ', css, attrs);
  expect(cell).toMatchObject({ text: 'ordinary source text', style: { wrap: true } });
  expect(cellsFromHtmlRows([[cell]])[0].cell).toMatchObject({ v: 'ordinary source text', s: { wrap: true } });
});

it('keeps absent or invalid wrapping unspecified and honors explicit overrides', () => {
  for (const css of ['', 'td {white-space:invalid}', 'table {white-space:normal} td {white-space:nowrap}']) {
    expect(parse('one line', css).style?.wrap).toBe(css.includes('nowrap') ? false : undefined);
  }
  expect(parse('a\n b', 'table {white-space:normal} td {white-space:pre}')).toMatchObject({ text: 'a\n b', style: { wrap: false } });
});

it('keeps explicit breaks, block boundaries and nested whitespace overrides distinct', () => {
  expect(parse('first\n line<br>next<div> last\n line </div>').text).toBe('first line\nnext\nlast line');
  expect(parse('a<br><br>b<br>').text).toBe('a\n\nb\n');
  expect(parse(' A\n <span style="white-space:pre-wrap"> B  \n C </span>\nD ').text).toBe('A  B  \n C  D');
  expect(parse('a <pre>  b\n c </pre> d').text).toBe('a\n  b\n c \nd');
  expect(parse('<pre>  a\n b </pre>', 'pre {white-space:normal}').text).toBe('a b');
  expect(parse('<pre>  a<span>\n b</span> </pre>').text).toBe('  a\n b ');
  expect(parse('  a\n b ', 'td {white-space:PRE-WRAP}')).toMatchObject({ text: '  a\n b ', style: { wrap: true } });
  expect(parse('<span style="white-space:normal"> a\n b </span>', 'td {white-space:pre-wrap}').text).toBe('a b');
});

it('retains nested table separators and ignores formatting between block elements', () => {
  expect(parse('Total<table>\n<tr><td></td><td> a\n b </td></tr>\n<tr><td>c</td><td>d</td></tr>\n</table>').text).toBe('Total\n\ta b\nc\td');
  expect(parse('\n<p>a\nb</p>\n<p>c\nd</p>\n').text).toBe('a b\nc d');
});

it('honors explicit typed strings without normalizing their data', () => {
  const cell = parse('visual\n text', '', 'x:str="  stored&#13;&#10;value  "');
  expect(cell.text).toBe('visual text');
  expect(cellsFromHtmlRows([[cell]])[0].cell.v).toBe('  stored\r\nvalue  ');
});

it('handles deeply nested inline text without recursion and repeated source whitespace linearly', () => {
  expect(parse('<span>'.repeat(3000) + 'a\n b' + '</span>'.repeat(3000)).text).toBe('a b');
  expect(parse('a\r\n '.repeat(10000)).text).toBe('a '.repeat(9999) + 'a');
});

it('preserves collapsed and preformatted values through paste, external HTML and native XLSX', async () => {
  const source = [parse('wrapped\r\n  source', 'td {white-space:normal}'), parse('  pre\ttext\nnext  ', 'td {white-space:pre-wrap}')];
  const cells = cellsFromHtmlRows([source]).map(x => x.cell);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.pasteCells(id, [cells], 0, 0);
  const values = [['wrapped source', '  pre\ttext\nnext  ']];
  expect(wb.rangeValues(id, { r1: 0, c1: 0, r2: 0, c2: 1 })).toEqual(values);
  const copied = cellsToHtml(values, wb.copyRange(id, { r1: 0, c1: 0, r2: 0, c2: 1 })).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(cellsFromHtmlRows(parseHtmlClipboard(copied).rows).map(x => x.cell.v)).toEqual(values[0]);
  const blob = await workbookToXlsx(wb);
  const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(new Uint8Array(data), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.rangeValues(back.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 1 })).toEqual(values);
  expect(back.styleAt(back.activeSheetId, 0, 0).wrap).toBe(true);
  expect(back.styleAt(back.activeSheetId, 0, 1).wrap).toBe(true);
});
