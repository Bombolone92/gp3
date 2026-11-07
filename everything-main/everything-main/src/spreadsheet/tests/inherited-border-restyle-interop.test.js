import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
beforeEach(() => vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser));
afterEach(() => vi.unstubAllGlobals());
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { borderSnapshot } from '../src/core/border-regions.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
const block = { r1: 3, c1: 2, r2: 9, c2: 3 };
function book() {
  const wb = new Workbook({ sheets: [{ name: 'Restyle', colStyles: { 2: { br: true, bc: '#225599', bs: 'double' } },
    rowStyles: { 6: { bt: true, btBorder: { bs: 'dotted', bc: '#663399' } } },
    cells: { '4,2': { v: 8 }, '5,2': { f: 'C5*2', s: { bb: true, bbBorder: { bs: 'thick', bc: '#aa2200' } } } } }] });
  wb.applyBorders(wb.activeSheetId, block, 'restyle', { color: '#118855' });
  return wb;
}
const nativeOnly = async wb => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
};
it.each([false, true])('round-trips actual restyling twice, including blank inherited intersections (native-only=%s)', async foreign => {
  let wb = book(); const expected = Array.from({ length: 11 }, (_, r) => Array.from({ length: 5 }, (_, c) => borderSnapshot(wb.styleAt(wb.activeSheetId, r, c))));
  for (let i = 0; i < 2; i++) {
    wb = await workbookFromFile(foreign ? await nativeOnly(wb) : new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'restyle.xlsx');
    for (let r = 0; r < 11; r++) for (let c = 0; c < 5; c++) expect(borderSnapshot(wb.styleAt(wb.activeSheetId, r, c))).toEqual(expected[r][c]);
    expect(wb.getValue(wb.activeSheetId, 5, 2)).toBe(16);
  }
});
it.each([false, true])('carries restyled borders through clipboard and export (foreign HTML=%s)', async foreign => {
  const wb = book(), id = wb.activeSheetId, cells = wb.copyRange(id, block);
  let html = cellsToHtml(cells.map((row, i) => row.map((_, j) => wb.getDisplay(id, block.r1 + i, block.c1 + j))), cells);
  if (foreign) html = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html), destination = new Workbook(), destId = destination.activeSheetId;
  if (foreign) destination.setCells(destId, cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => ({ r: i + 2, c: j + 4, cell })));
  else destination.pasteCells(destId, parsed.cells, 2, 4);
  const back = await workbookFromFile(await nativeOnly(destination), 'copied.xlsx');
  for (let r = 0; r <= block.r2 - block.r1; r++) for (let c = 0; c < 2; c++) expect(borderSnapshot(back.styleAt(back.activeSheetId, r + 2, c + 4))).toEqual(borderSnapshot(wb.styleAt(id, r + block.r1, c + block.c1)));
});
