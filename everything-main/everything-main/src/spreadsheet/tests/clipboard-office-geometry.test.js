import fs from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseHtmlClipboard, cellsFromHtmlRows, cellsToHtml } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

beforeAll(() => vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser));
afterAll(() => vi.unstubAllGlobals());

const native = JSON.parse(fs.readFileSync('tests/fixtures/reference-html-table-geometry.json'));
for (const control of native.controls) it(`reconstructs native Excel table geometry: ${control.name}`, () => {
  const parsed = parseHtmlClipboard(control.html);
  expect(parsed.error).toBeUndefined();
  expect(parsed.rows).toHaveLength(control.rows);
  expect(parsed.rows.every(row => row.length === control.cols)).toBe(true);
  expect(parsed.merges || []).toEqual(control.merges);
  const cells = cellsFromHtmlRows(parsed.rows);
  for (const { r, c, value, style } of control.cells) {
    const cell = cells.find(cell => cell.i === r && cell.j === c)?.cell;
    expect(cell?.v ?? null, `${r},${c}`).toBe(value);
    const merge = control.merges.find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);
    const fillCell = merge ? cells.find(cell => cell.i === merge.r1 && cell.j === merge.c1)?.cell : cell;
    expect(fillCell?.s?.bg, `painted fill ${r},${c}`).toBe(style.bg);
    for (const side of ['bt', 'bb', 'bl', 'br']) {
      expect(!!cell?.s?.[side], `${side} ${r},${c}`).toBe(!!style[side]);
      if (style[side]) expect(cell.s[`${side}Border`]).toMatchObject({ bc: style.bc });
    }
  }
});

it('reads actual Excel clipboard overflow as separate cells and preserves the TSV shape', () => {
  const html = fs.readFileSync('tests/fixtures/reference-overflow-clipboard.html', 'utf8');
  const parsed = parseHtmlClipboard(html);
  expect(parsed.rows).toHaveLength(12);
  expect(parsed.rows.every(row => row.length === 2)).toBe(true);
  expect(parsed.merges).toBeUndefined();
  expect(parsed.rows[5][0].text).toBe('blank zero text');
  expect(parsed.rows[8][0].text).toBe('float arithmetic');
});

it('honors CSS cascade and exact Office ignore tokens without changing genuine merges', () => {
  const parsed = parseHtmlClipboard(`<style>.display{mso-ignore:COLSPAN!important}.normal{mso-ignore:not-colspan}</style><table>
    <tr><td class="display" colspan="3" style="mso-ignore:none">Spill</td><td>Next</td></tr>
    <tr><td class="normal" colspan="2">Merge</td><td colspan="2" style="mso-ignore:rowspan">Also merge</td></tr>
    </table>`);
  expect(parsed.rows[0].map(c => c.text)).toEqual(['Spill', '', '', 'Next']);
  expect(parsed.merges).toEqual([{ r1: 1, c1: 0, r2: 1, c2: 1 }, { r1: 1, c1: 2, r2: 1, c2: 3 }]);
});

it('keeps row groups, nested tables and real vertical spans in logical row coordinates', () => {
  const parsed = parseHtmlClipboard(`<table><tbody><tr><td rowspan="0">Head</td><td>Start</td></tr>
    <tr style="mso-xlrowspan:3"><td>Once<table><tr><td>Nested</td></tr></table></td></tr></tbody>
    <tbody><tr><td>New group</td><td>End</td></tr></tbody></table>`);
  expect(parsed.rows).toHaveLength(5);
  expect(parsed.merges).toEqual([{ r1: 0, c1: 0, r2: 3, c2: 0 }]);
  expect(parsed.rows[4].map(c => c.text)).toEqual(['New group', 'End']);
  expect(parsed.rows[2].every(c => c.text === '')).toBe(true);
});

it('keeps compacted rows blank while refining the first value with Office TSV', () => {
  const html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table><tr style="mso-xlrowspan:3"><td x:str>hashes</td></tr><tr><td>End</td></tr></table></html>';
  const parsed = parseHtmlClipboard(html, 'Full value\n\n\nEnd');
  expect(parsed.rows.map(r => r[0].text)).toEqual(['Full value', '', '', 'End']);
  expect(cellsFromHtmlRows(parsed.rows).map(c => c.cell?.v ?? null)).toEqual(['Full value', null, null, 'End']);
});

it('bounds row expansion and the final rectangular area before allocating cell data', () => {
  for (const value of ['200001', '99999999999999999999999999999999999']) expect(parseHtmlClipboard(`<table><tr style="mso-xlrowspan:${value}"><td></td></tr></table>`).error).toMatch(/too large/);
  expect(parseHtmlClipboard('<table><tr style="mso-xlrowspan:1000"><td colspan="201" style="mso-ignore:colspan"></td></tr></table>').error).toMatch(/too large/);
  for (const value of ['-1', '2.5', '3px', 'NaN', '0']) expect(parseHtmlClipboard(`<table><tr style="mso-xlrowspan:${value}"><td>A</td></tr><tr><td>B</td></tr></table>`).rows).toHaveLength(2);
});

it('retains separate editable cells and real merges through external HTML and native-only XLSX', async () => {
  const parsed = parseHtmlClipboard(native.controls[0].html), w = new Workbook(), id = w.activeSheetId;
  w.setCells(id, cellsFromHtmlRows(parsed.rows).map(({i,j,cell}) => ({r:i,c:j,cell})));
  for (const merge of parsed.merges || []) w.mergeCells(id, merge);
  w.clearHistory();
  w.setInput(id, 0, 1, 'Independent edit');
  expect(w.getValue(id, 0, 0)).toBe('Overflow title');
  expect(w.getValue(id, 0, 1)).toBe('Independent edit');
  w.undo(); expect(w.getValue(id, 0, 1)).toBeNull(); w.redo();
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'}),book=X.CFB.find(zip,'/xl/workbook.xml');
  book.content=new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;
  const back=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native-only.xlsx');
  expect(back.activeSheet.merges).toEqual(parsed.merges);
  expect(back.getValue(back.activeSheetId,0,1)).toBe('Independent edit');
  expect(back.getValue(back.activeSheetId,4,0)).toBe('after blank run');
  const cells=Array.from({length:5},(_,r)=>Array.from({length:4},(_,c)=>back.getCell(back.activeSheetId,r,c)||null));
  const html=cellsToHtml(cells.map(row=>row.map(c=>String(c?.v??''))),cells).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
  expect(parseHtmlClipboard(html).merges).toBeUndefined();
});
