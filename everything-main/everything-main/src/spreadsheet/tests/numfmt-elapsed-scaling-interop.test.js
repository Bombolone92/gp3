// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

it('retains elapsed boundaries through recalculation, clipboard and external XLSX', async () => {
  const cases = [
    [59.5 / 86400, '[m]', '1'], [59.5 / 86400, '[s]', '60'],
    [59.5 / 86400, '[m]:ss', '1:59'],
    [2958465 + 59.4999 / 86400, '[s]', '255611376059'],
    [2958465.000694439, '[m].000', '4260189601.999'],
  ];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, display]] of cases.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(display);
    expect(wb.getValue(id, r, 1)).toBe(display);
    const html = cellsToHtml([[display]], [[wb.getCell(id, r, 0)]], null, [[value]]);
    expect(parseHtmlClipboard(html).cells[0][0].v).toBe(value);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(value); expect(pasted.s.code).toBe(code);
  }
  wb.setInput(id, 0, 0, String(30 / 86400));
  expect(wb.getDisplay(id, 0, 0)).toBe('0'); expect(wb.getValue(id, 0, 1)).toBe('0');
  wb.undo(); expect(wb.getValue(id, 0, 1)).toBe('1');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'elapsed.xlsx');
  for (const [r, [value, code, display]] of cases.entries()) {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(display);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(display);
  }
});
