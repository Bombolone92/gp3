import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, cellsFromHtmlRows, parseHtmlClipboard } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

afterEach(() => vi.unstubAllGlobals());

it.each(['private', 'foreign'])('retains %s merged clipboard borders through metadata-free XLSX saves', async path => {
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  const merge = { r1: 0, c1: 0, r2: 2, c2: 3 }, cells = {};
  for (let r = 0; r <= merge.r2; r++) for (let c = 0; c <= merge.c2; c++) cells[`${r},${c}`] = {
    v: r === 0 && c === 0 ? 'Box' : null,
    s: { bt: r === 0, bl: c === 0, bb: r === merge.r2, br: c === merge.c2,
      btBorder: { bs: 'thin', bc: '#123456' }, blBorder: { bs: 'dashed', bc: '#654321' },
      bbBorder: { bs: 'double', bc: '#338855' }, brBorder: { bs: 'medium', bc: '#884477' } },
  };
  const source = new Workbook({ sheets: [{ name: 'Source', cells, merges: [merge] }] });
  const rows = [0, 1, 2], cols = [0, 1, 2, 3], copy = source.copyRange(source.activeSheetId, merge);
  let html = cellsToHtml(copy.map(row => row.map(c => c?.v ?? '')), copy, null, null, null, { merges: [merge], rows, cols });
  if (path === 'foreign') html = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html);
  const pasted = parsed.cells ? Object.fromEntries(parsed.cells.flatMap((row, r) => row.map((cell, c) => [`${r},${c}`, cell])))
    : Object.fromEntries(cellsFromHtmlRows(parsed.rows).map(({ i, j, cell }) => [`${i},${j}`, cell]));
  let wb = new Workbook({ sheets: [{ name: 'Pasted', cells: pasted, merges: parsed.merges }] });
  for (let save = 0; save < 2; save++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'merged.xlsx');
    const id = wb.activeSheetId;
    expect(wb.activeSheet.merges).toEqual([merge]);
    expect(wb.getValue(id, 0, 0)).toBe('Box');
    const border = (r, c, key, expected) => {
      const style = wb.styleAt(id, r, c);
      expect(style[key]).toBe(true);
      // A native cell with one visible side uses the shared descriptor.
      const descriptor = style[`${key}Border`] || style;
      expect({ bs: descriptor.bs || 'thin', bc: descriptor.bc }).toEqual(expected);
    };
    for (const c of cols) {
      border(0, c, 'bt', { bs: 'thin', bc: '#123456' });
      border(2, c, 'bb', { bs: 'double', bc: '#338855' });
    }
    for (const r of rows) {
      border(r, 0, 'bl', { bs: 'dashed', bc: '#654321' });
      border(r, 3, 'br', { bs: 'medium', bc: '#884477' });
    }
  }
});
