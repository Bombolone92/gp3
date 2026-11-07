// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calcValues } from './helpers/calc.js';

const native = [
  [-2.75, '[h]', '-66'], [-2.75, '[m]', '-3960'], [-2.75, '[s]', '-237600'],
  [-2.75, '[h] h', '-66 66'], [-2.75, '[s] s', '-237600 237600'],
  [-2.75, '[h]" hours"', '-66 hours'], [-2.75, '[h]"-"', '-66-'],
  [-2.75, '[h];[h]', '66'], [-2.75, '[h];"neg "[h]', 'neg 66'],
  [-2.75, '[<0][h];0', '66'], [-2.75, '[<0]-[h];0', '-66'],
  [-2.75, '[>0][h];[h]', '66'],
  [-0.5 / 86400, '[h]', '-0'], [-0.5 / 86400, '[hh]', '-00'],
  [-0.5 / 86400, '[m]', '-0'], [-0.5 / 86400, '[s]', '-1'],
  [-0.5 / 86400, '[h] h', '-0 0'], [-0.5 / 86400, '[h];[h]', '0'],
  [-59.5 / 86400, '[m]', '-1'], [-59.5 / 86400, '[s]', '-60'],
  [-45000.5, '[h]', '-1080012'], [-2958466, '[h]', '-71003184'],
  [-1e22, '[h]', '-240000000000000000000000'],
];
// The expected values were measured in Excel cells and TEXT.
it.each(native)('formats the signed total %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
  expect(calcValues('TEXT(A1,B1)', {A1:value,B1:code})).toBe(expected);
});

it.each(['[h]:mm', '[m]:ss', '[h].000', '[s].000', '[h] d', 'yyyy-mm-dd', 'h:mm'])('keeps negative calendar/clock serials invalid in %s', code => {
  for (const value of [-0.5 / 86400, -2.75, -2958466, -1e22]) {
    expect(formatWithCode(value, code)).toBe('#####');
    expect(calcValues('TEXT(A1,B1)', {A1:value,B1:code})).toEqual({ error: '#VALUE!' });
  }
});

it('uses only the selected section when deciding whether a calendar is required', () => {
  expect(formatWithCode(-2.75, 'yyyy-mm-dd;[h]')).toBe('66');
  expect(formatWithCode(-2.75, '[h];yyyy-mm-dd')).toBe('#####');
  expect(formatWithCode(-0, '[h]')).toBe('0');
  expect(formatWithCode(0, '[h]')).toBe('0');
  expect(formatWithCode(2.75, '[h]')).toBe('66');
});

it('preserves negative serials and sign rules through edits, HTML and metadata-free XLSX', async () => {
  const cases = native.slice(0, 3).concat(native.slice(7, 9));
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, expected]] of cases.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code.replaceAll('"', '""')}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(expected);
    expect(wb.getValue(id, r, 1)).toBe(expected);
    const html = cellsToHtml([[expected]], [[wb.getCell(id, r, 0)]], null, [[value]]);
    expect(parseHtmlClipboard(html).cells[0][0].v).toBe(value);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(value); expect(pasted.s.code).toBe(code);
  }
  wb.setInput(id, 0, 0, '1.5'); expect(wb.getValue(id, 0, 1)).toBe('36');
  wb.undo(); expect(wb.getValue(id, 0, 1)).toBe('-66');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'negative-elapsed.xlsx');
  for (const [r, [value, code, expected]] of cases.entries()) {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(expected);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(expected);
  }
});
