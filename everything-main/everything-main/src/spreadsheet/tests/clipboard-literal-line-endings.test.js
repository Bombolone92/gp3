// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const office = body => `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table><tr>${body}</tr></table></html>`;
const values = html => cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x => x.cell?.v);

it('matches the saved native literal-CR and CRLF clipboard control', () => {
  // Chrome system clipboard -> Excel 16.113 -> saved XLSX, 2026-09-21.
  // null-string-edge-native.xlsx, Sheet1!B5, SHA-256:
  // f5291a27fd5a0d7328608640396d4b27875460e836fdfe808130849a8b56603f
  expect(values(office('<td x:str="a\r0&#0;b\r\n1"><b>display</b></td>'))).toEqual(['a\r0\0b\r\n1']);
});

it('preserves quoted literal line endings independently of numeric NUL references', () => {
  for (const tag of ['td', 'th']) for (const quote of ['"', "'"]) {
    for (const text of ['\r', '\r\n', '\n', '\r\r\n', 'a\rb\r\nc\nd', 'İ😀\r雪']) {
      expect(values(office(`<${tag} x:str=${quote}${text}${quote}>display</${tag}>`)), text).toEqual([text]);
    }
  }
  // Unquoted attribute whitespace terminates the value; bare markers read markup.
  expect(values(office('<td x:str=a\rb>display</td><td x:str>a\rb</td><td>a\r\nb</td>'))).toEqual(['a', 'a b', 'a b']);
});

it('keeps escaped text, CR references and encoding-prefix characters distinct', () => {
  const source = '\r0\r1\r01&#13;0&#xD;1&#00013;01\r\n&amp;#13;1&NewLine;0&#0;';
  expect(values(office(`<td x:str="${source}">display</td>`))).toEqual(['\r0\r1\r01\r0\r1\r01\r\n&#13;1\n0\0']);
  expect(values(office('<td x:str="a\rb" x:str="ignored\r">display</td><td x:str="kept" x:str="ignored\r">display</td>'))).toEqual(['a\rb', 'kept']);
  expect(values(office('<td title="<td x:str=\'fake\r\'>" x:str="a\r\nb">display</td>'))).toEqual(['a\r\nb']);
});

it('reuses the first DOM when CR occurs only outside explicit cell strings', () => {
  const spy = vi.spyOn(DOMParser.prototype, 'parseFromString');
  try {
    expect(values(office('\r\n<td x:str="kept">a\rb</td><!-- <td x:str="fake\r"> -->'))).toEqual(['kept']);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    const html = office('<td data-office-empty-string="nul" x:str="a\rb">display</td>');
    expect(values(html)).toEqual(['a\rb']);
    expect(spy).toHaveBeenCalledTimes(2);
    const td = spy.mock.results.at(-1).value.querySelector('td');
    expect(td.getAttributeNames()).toEqual(['data-office-empty-string', 'x:str']);
    expect(td.getAttribute('x:str')).toBe('a\rb');
  } finally { spy.mockRestore(); }
});

it('retains pasted line endings through private/external copies, editing, Undo and native XLSX', async () => {
  const text = 'first\rsecond\r\nthird\nfourth';
  const cell = cellsFromHtmlRows(parseHtmlClipboard(office(`<td x:str="${text}">display</td>`)).rows)[0].cell;
  const html = cellsToHtml([[text]], [[cell]], null, [[text]]);
  expect(parseHtmlClipboard(html).cells[0][0].v).toBe(text);
  const foreign = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(values(foreign)).toEqual([text]);
  expect(values(cellsToHtml([[text]], null, null, [[text]]))).toEqual([text]);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{r:0,c:0,cell}, {r:0,c:1,cell:{f:'LEN(A1)'}}]);
  expect(wb.getValue(id,0,1)).toBe(text.length);
  wb.setInput(id,0,0,'edited'); wb.undo();
  expect(wb.getValue(id,0,0)).toBe(text);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(new Uint8Array(bytes), {type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'line-endings');
  expect(back.getValue(back.activeSheetId,0,0)).toBe(text);
  expect(back.getValue(back.activeSheetId,0,1)).toBe(text.length);
});
