import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { borderSnapshot } from '../src/core/border-regions.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
beforeEach(() => vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser));
afterEach(() => vi.unstubAllGlobals());
const box = { r1: 1, c1: 1, r2: 800, c2: 70 };
const side = (wb, r, c) => borderSnapshot(wb.styleAt(wb.activeSheetId, r, c));
const make = () => new Workbook({ sheets: [{ name: 'Paint', rows: 1000, cols: 80, cells: { '750,60': { v: 8 }, '751,60': { f: 'BI751*2' } } }] });
async function zipFor(wb) { return X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' }); }
function withoutMeta(zip) {
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
it.each([false, true])('exports distant blank borders and reopens repeated saves (native-only=%s)', async nativeOnly => {
  let wb = make(); wb.applyBorders(wb.activeSheetId, box, 'all', { style: 'double', color: '#225599' });
  const json = wb.toJSON(), expected = side(wb, 799, 69);
  for (let i = 0; i < 2; i++) {
    const zip = await zipFor(wb);
    if (!i) expect(wb.toJSON()).toEqual(json);
    wb = await workbookFromFile(nativeOnly ? withoutMeta(zip) : X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'paint.xlsx');
    for (const [r, c] of [[1, 1], [400, 40], [799, 69], [800, 70]]) expect(side(wb, r, c)).toEqual(expected);
    expect(side(wb, 801, 70).br).toBe(false); expect(wb.getValue(wb.activeSheetId, 751, 60)).toBe(16);
  }
});
it('exports whole-column painting as native line defaults and row-origin exceptions as finite blank cells', async () => {
  const wb = make(), id = wb.activeSheetId;
  wb.applyBorders(id, { r1: 0, c1: 3, r2: 999, c2: 5, scope: 'columns' }, 'all', { style: 'medium' });
  wb.applyBorders(id, { r1: 10, c1: 0, r2: 12, c2: 79, scope: 'rows' }, 'outer', { style: 'double' });
  const zip = await zipFor(wb), xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  expect((xml.match(/<c\b/g) || []).length).toBeLessThan(30);
  const back = await workbookFromFile(withoutMeta(zip), 'lines.xlsx'), dest = back.activeSheetId;
  expect(side(back, 800000, 4)).toMatchObject({ bt: true, bb: true, bl: true, br: true });
  expect(side(back, 10, 10000).btBorder.bs).toBe('double');
  expect(side(back, 11, 0).blBorder.bs).toBe('double');
  expect(back.getValue(dest, 751, 60)).toBe(16);
});
it.each([false, true])('copies a distant newly painted region through HTML and native XLSX (foreign=%s)', async foreign => {
  const wb = make(), id = wb.activeSheetId;
  wb.applyBorders(id, box, 'all', { style: 'dotted', color: '#118855' });
  const area = { r1: 749, c1: 59, r2: 752, c2: 61 }, cells = wb.copyRange(id, area);
  let html = cellsToHtml(cells.map((row, i) => row.map((_, j) => wb.getDisplay(id, i + area.r1, j + area.c1))), cells);
  if (foreign) html = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html), back = new Workbook(), dest = back.activeSheetId;
  if (foreign) back.setCells(dest, cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => ({ r: i, c: j, cell })));
  else back.pasteCells(dest, parsed.cells, 0, 0);
  const reopened = await workbookFromFile(withoutMeta(await zipFor(back)), 'copy.xlsx');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) expect(side(reopened, r, c)).toEqual(side(wb, r + area.r1, c + area.c1));
});
