// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { hasClipboardSnapshot } from '../src/core/clipboard-integrity.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const documentOf = html => new DOMParser().parseFromString(html, 'text/html');
const serialize = html => documentOf(html).documentElement.outerHTML;
const valuesOf = parsed => cellsFromHtmlRows(parsed.rows).map(x => x.cell?.v);

it('recovers original line endings from verified values-only snapshots after repeated DOM serialization', () => {
  const row = ['\r', '\r\n', '\r\r\n', 'a\rb\r\nc\nd', 'İ😀\r雪', '\u0082\r\nb', '\0\r\n\uFFFD', '\n', '\u2028\u2029', 'a&#13;b'];
  let html = cellsToHtml([row], null, null, [row]);
  for (let round = 0; round < 4; round++) {
    const parsed = parseHtmlClipboard(html);
    expect(parsed.cells).toBeUndefined();
    expect(parsed.values).toEqual([row]);
    expect(valuesOf(parsed), `serialization ${round}`).toEqual(row);
    html = serialize(html);
  }
});

it('does not need a second DOM to restore a verified snapshot', () => {
  const html = serialize(cellsToHtml([['a\r\nb']], null, null, [['a\r\nb']]));
  const spy = vi.spyOn(DOMParser.prototype, 'parseFromString');
  try {
    expect(valuesOf(parseHtmlClipboard(html))).toEqual(['a\r\nb']);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally { spy.mockRestore(); }
});

it('keeps current text when external edits invalidate the captured snapshot', () => {
  const doc = documentOf(cellsToHtml([['old\r\ntext']], null, null, [['old\r\ntext']]));
  const td = doc.querySelector('td');
  td.setAttribute('x:str', 'new\r\ntext');
  td.textContent = 'new text';
  expect(hasClipboardSnapshot(doc.querySelector('table'))).toBe(false);
  const parsed = parseHtmlClipboard(doc.documentElement.outerHTML);
  expect(parsed.values).toBeUndefined();
  expect(valuesOf(parsed)).toEqual(['new\r\ntext']);
});

it('does not overwrite incompatible explicit values with altered snapshot data', () => {
  // The markup stamp covers the table's body, not its optional value payload.
  // Even a well-shaped payload must agree with the explicit typed value.
  for (const stored of ['other\rtext', 'a\r\nb!', '\r', 12, true, {error:'#N/A'}]) {
    const doc = documentOf(cellsToHtml([['a\r\nb']], null, null, [['a\r\nb']]));
    doc.querySelector('table').setAttribute('data-spreadsheet-values', JSON.stringify([[stored]]));
    expect(hasClipboardSnapshot(doc.querySelector('table'))).toBe(true);
    expect(valuesOf(parseHtmlClipboard(doc.documentElement.outerHTML)), String(stored)).toEqual(['a\nb']);
  }
  for (const [actual,stored] of [[7,'7\r'], [false,'FALSE\r'], ['new','old\r']]) {
    const doc = documentOf(cellsToHtml([[String(actual)]], null, null, [[actual]]));
    doc.querySelector('table').setAttribute('data-spreadsheet-values', JSON.stringify([[stored]]));
    expect(parseHtmlClipboard(doc.documentElement.outerHTML).rows[0][0].value).toBe(actual);
  }
});

it('keeps values past the full-cell metadata budget after DOM serialization', {timeout:60000}, () => {
  const matrix = Array.from({length:5001}, (_,r) => [`row ${r}\r\nnext`]);
  const cells = matrix.map(([v]) => [{v}]);
  const html = serialize(cellsToHtml(matrix, cells, null, matrix));
  const parsed = parseHtmlClipboard(html);
  expect(parsed.cells).toBeUndefined();
  expect(parsed.values).toEqual(matrix);
  expect(valuesOf(parsed)).toEqual(matrix.map(row => row[0]));
});

it('retains recovered line endings through edit, undo, copying and metadata-free XLSX', async () => {
  const text = 'first\rsecond\r\nthird\nfourth';
  const parsed = parseHtmlClipboard(serialize(cellsToHtml([[text]], null, null, [[text]])));
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [...cellsFromHtmlRows(parsed.rows).map(({i,j,cell}) => ({r:i,c:j,cell})),
    {r:0,c:1,cell:{f:'LEN(A1)'}}, {r:0,c:2,cell:{f:'UNICODE(MID(A1,6,1))'}}]);
  expect(wb.getValue(id,0,0)).toBe(text);
  expect(wb.getValue(id,0,1)).toBe(26);
  expect(wb.getValue(id,0,2)).toBe(13);
  wb.setInput(id,0,0,'edited'); wb.undo();
  const html = cellsToHtml([[text]], [[wb.getCell(id,0,0)]], null, [[wb.getValue(id,0,0)]]);
  expect(parseHtmlClipboard(serialize(html)).cells[0][0].v).toBe(text);
  const foreign = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  expect(valuesOf(parseHtmlClipboard(serialize(foreign)))).toEqual([text]);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(new Uint8Array(bytes), {type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'snapshot-line-endings');
  expect(back.getValue(back.activeSheetId,0,0)).toBe(text);
  expect(back.getValue(back.activeSheetId,0,1)).toBe(26);
  expect(back.getValue(back.activeSheetId,0,2)).toBe(13);
});
