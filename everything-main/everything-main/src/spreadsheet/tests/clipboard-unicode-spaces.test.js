// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const parse = (html, mode = 'normal') => parseHtmlClipboard(`<table style="white-space:${mode}"><tr><td>${html}</td></tr></table>`).rows[0][0];
const external = html => html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
// Excel for Mac HTML paste references, saved 2026-09-19.
const native = [
  ['a&nbsp;b', 'a\u00a0b'], ['&nbsp;&nbsp;x', '\u00a0\u00a0x'], ['x&nbsp;&nbsp;', 'x\u00a0\u00a0'],
  ['&nbsp;&nbsp;', '\u00a0\u00a0'], ['a\n&nbsp;\n b', 'a \u00a0 b'], ['a<span>&nbsp;</span>b', 'a\u00a0b'],
  ['<span style="mso-spacerun:no">&nbsp;&nbsp;</span>x', '\u00a0\u00a0x'],
  ['<span style="mso-spacerun:yes">&nbsp;&nbsp;</span>x', '  x'],
  ['<span style="white-space:pre">&nbsp;x&nbsp;</span>', '\u00a0x\u00a0'],
  ['<span style="white-space:pre-line">&nbsp;x<br>&nbsp;y</span>', '\u00a0x\n\u00a0y'],
  ['a&#8239;b', 'a\u202fb'], ['a&#12288;b', 'a\u3000b'], [' a\n  b ', 'a b'], ['كانون&nbsp;الثاني', 'كانون\u00a0الثاني'],
];

it('preserves native Unicode spaces while collapsing HTML source indentation', () => {
  for (const [html, expected] of native) {
    const cell = parse(html);
    expect(cell.text, html).toBe(expected);
    expect(cellsFromHtmlRows([[cell]])[0].cell.v, html).toBe(expected);
  }
});

it.each(['normal', 'nowrap', 'pre-line'])('keeps Unicode separators at text and inline boundaries under %s', mode => {
  for (const space of ['\u00a0', '\u2002', '\u2003', '\u2007', '\u2009', '\u202f', '\u3000']) {
    expect(parse(` ${space}<b>x</b>${space} `, mode).text).toBe(`${space}x${space}`);
    expect(parse(`x<span>${space}</span><i>${space}</i>y`, mode).text).toBe(`x${space}${space}y`);
    expect(cellsFromHtmlRows([[parse(space, mode)]])[0].cell?.v ?? null).toBe(space === '\u00a0' ? null : space);
  }
  expect(parse('&nbsp;<br>&nbsp;', mode).text).toBe('\u00a0\n\u00a0');
  expect(parse('<div>&nbsp;x</div><div>&nbsp;y</div>', mode).text).toBe('\u00a0x\n\u00a0y');
});

it('distinguishes an empty-cell placeholder from typed one-NBSP text', () => {
  for (const html of ['&nbsp;', '<span>&nbsp;</span>', ' &nbsp; ']) {
    expect(cellsFromHtmlRows([[parse(html)]])[0].cell?.v ?? null).toBe(null);
  }
  for (const attr of ['x:str="&#160;"', 'x:str="\u00a0"']) {
    const rows = parseHtmlClipboard(`<table><tr><td ${attr}>&nbsp;</td></tr></table>`).rows;
    expect(cellsFromHtmlRows(rows)[0].cell.v).toBe('\u00a0');
  }
});

it('preserves Unicode spaces through HTML paste, edits, undo and metadata-free XLSX', async () => {
  const values = ['كانون\u00a0الثاني', '\u00a0\u00a0x', 'x\u202f', '\u3000x\u3000', '\u00a0', '\u00a0x\n\u00a0y'];
  const wb = new Workbook(), id = wb.activeSheetId;
  const cells = cellsFromHtmlRows(parseHtmlClipboard(external(cellsToHtml([values], [values.map(v => ({v, s:{wrap:true}}))], null, [values]))).rows).map(x => x.cell);
  wb.pasteCells(id, [cells], 0, 0);
  wb.setInput(id, 1, 0, '=EXACT(A1,"كانون الثاني")');
  expect(wb.getValue(id, 1, 0)).toBe(true);
  wb.setInput(id, 0, 0, 'changed'); expect(wb.getValue(id, 1, 0)).toBe(false);
  wb.undo(); expect(wb.getValue(id, 1, 0)).toBe(true);
  const html = external(cellsToHtml([values], wb.copyRange(id, {r1:0,c1:0,r2:0,c2:values.length-1}), null, [values]));
  expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x => x.cell.v)).toEqual(values);
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, {type:'array'}), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, {type:'array',fileType:'zip'}), 'spaces.xlsx');
  expect(back.rangeValues(back.activeSheetId, {r1:0,c1:0,r2:0,c2:values.length-1})).toEqual([values]);
  expect(back.getValue(back.activeSheetId, 1, 0)).toBe(true);
});
