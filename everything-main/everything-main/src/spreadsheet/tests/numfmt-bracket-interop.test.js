// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { formatCodeError } from '../src/core/numfmt.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

it('retains bracket codes and TEXT semantics through editing, clipboard and external XLSX', async () => {
  const cases = [
    [2.75, '[Redx]0', '3'], [-2.75, '[>0]0;0.0', '2.8'],
    [1.23456789012345, '[=1.234567890123456]"same";"other"', 'same'],
    [2.75, '[xyz]0', { error: '#VALUE!' }],
    ['label', '0;[x]0', { error: '#VALUE!' }],
    [true, '0;0;0;[x]@', { error: '#VALUE!' }],
  ];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, expected]] of cases.entries()) {
    wb.setInput(id, r, 0, String(value)); wb.setInput(id, r, 1, `'${code}`);
    wb.setInput(id, r, 2, `=TEXT(A${r + 1},B${r + 1})`);
    expect(wb.getValue(id, r, 2)).toEqual(expected);
    if (!formatCodeError(code)) {
      wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
      const html = cellsToHtml([[expected]], [[wb.getCell(id, r, 0)]], null, [[value]]);
      expect(parseHtmlClipboard(html).cells[0][0].v).toBe(value);
      const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
      const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
      expect(pasted.v).toBe(value); expect(pasted.s.code).toBe(code);
    }
  }
  wb.setInput(id, 3, 1, '\'"[xyz]"0');
  expect(wb.getValue(id, 3, 2)).toBe('[xyz]3');
  wb.undo(); expect(wb.getValue(id, 3, 2)).toEqual({ error: '#VALUE!' });
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'brackets.xlsx');
  for (const [r, [value, code, expected]] of cases.entries()) {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(code);
    expect(restored.getValue(restored.activeSheetId, r, 2)).toEqual(expected);
    if (!formatCodeError(code)) {
      expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
      expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(expected);
    }
  }
});
