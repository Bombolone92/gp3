import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

const box = { r1: 4, c1: 2, r2: 6, c2: 4 };
const book = () => new Workbook({ sheets: [{ name: 'Clear borders',
  colStyles: { 2: { bt: true, bb: true, bl: true, br: true, bs: 'thick', bc: '#2255cc', bg: '#fff0cc' } },
  rowStyles: { 5: { bl: true, blBorder: { bs: 'dashed', bc: '#993355' }, bold: true } },
  cells: { '4,2': { v: 7 }, '6,2': { f: 'C5*2' } },
}] });
const plain = (wb, r, c) => {
  const style = wb.styleAt(wb.activeSheetId, r, c);
  for (const key of ['bt', 'bb', 'bl', 'br']) expect(style?.[key], `${r},${c} ${key}`).toBeFalsy();
};
async function exported(wb, nativeOnly) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  if (nativeOnly) {
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  }
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'clear.xlsx'),
    xml: new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content) };
}
afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('retains No Border through repeated XLSX saves, native-only=%s', async nativeOnly => {
  let wb = book(); wb.applyBorders(wb.activeSheetId, box, 'none');
  const before = wb.toJSON();
  for (let i = 0; i < 2; i++) {
    const saved = await exported(wb, nativeOnly); if (i === 0) expect(wb.toJSON()).toEqual(before); wb = saved.wb;
    for (let r = 4; r <= 6; r++) for (let c = 2; c <= 4; c++) plain(wb, r, c);
    expect(wb.getValue(wb.activeSheetId, 6, 2)).toBe(14);
    expect(wb.styleAt(wb.activeSheetId, 4, 2).bg).toBe('#fff0cc');
    expect(wb.styleAt(wb.activeSheetId, 5, 3).bold).toBe(true);
    expect(wb.styleAt(wb.activeSheetId, 7, 2).bl).toBe(true);
    const outside = wb.styleAt(wb.activeSheetId, 5, 5);
    expect(outside.bl).toBe(true);
    expect(outside.blBorder || { bs: outside.bs, bc: outside.bc }).toEqual({ bs: 'dashed', bc: '#993355' });
  }
});

it('exports a whole-column clear as a changed default plus only crossing-row exceptions', async () => {
  const wb = book(); wb.applyBorders(wb.activeSheetId, { r1: 0, c1: 2, r2: wb.activeSheet.rows - 1, c2: 2 }, 'none', { scope: 'columns' });
  const saved = await exported(wb, true);
  expect([...saved.xml.matchAll(/<c\b/g)]).toHaveLength(3);
  plain(saved.wb, 500000, 2); plain(saved.wb, 5, 2);
  expect(saved.wb.styleAt(saved.wb.activeSheetId, 5, 3).bl).toBe(true);
  expect(saved.wb.styleAt(saved.wb.activeSheetId, 500000, 2).bg).toBe('#fff0cc');
});

it('carries explicit cleared edges through private and external HTML clipboard formats', () => {
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  const wb = book(), id = wb.activeSheetId;
  wb.applyBorders(id, box, 'none');
  const copied = wb.copyRange(id, { r1: 4, c1: 2, r2: 4, c2: 2 });
  const html = cellsToHtml([['7']], copied);
  expect(parseHtmlClipboard(html).cells).toEqual(copied);
  const foreign = parseHtmlClipboard(html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, ''));
  for (const key of ['bt', 'bb', 'bl', 'br']) expect(foreign.rows[0][0].style[key]).toBe(false);
  wb.pasteCells(id, [[cellsFromHtmlRows(foreign.rows)[0].cell]], 20, 2);
  plain(wb, 20, 2); expect(wb.getValue(id, 20, 2)).toBe(7);
  const snapshot = parseHtmlClipboard(html).cells;
  wb.pasteStyles(id, snapshot, 6, 2); plain(wb, 6, 2);
  expect(wb.getValue(id, 6, 2)).toBe(14);
});
