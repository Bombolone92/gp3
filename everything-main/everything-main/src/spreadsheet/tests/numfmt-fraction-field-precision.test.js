// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import native from './fixtures/reference-clock-fraction-fields.json';

afterEach(() => setLocale('en-US'));

it('converts fractional fields at native precision across adjacent values and clock/calendar transitions', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, expected]] of native.cases.entries()) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected);
    wb.setCells(id, [{ r, c: 0, cell: { v: value } }, { r, c: 1, cell: { f: `TEXT(A${r + 1},"${code}")` } }]);
    expect(wb.getValue(id, r, 1), `${value}: TEXT ${code}`).toBe(expected);
  }
});

it('does not carry a converted fractional field into whole seconds or modify its General workspace', () => {
  const v = 0.000010995370370370368;
  expect(formatWithCode(v, '[DBNum1]General hh:mm:ss.0')).toBe('10 00:00:00.0');
  setLocale('de-DE');
  expect(formatWithCode(v, 'hh:mm:ss.0" end"')).toBe('00:00:00,0 end');
});

it('preserves raw boundary values through editing, HTML clipboard and metadata-free XLSX', async () => {
  const cases = [
    [5.787037037037033e-7, 'hh:mm:ss.0', '00:00:00.1'],
    [5.7870370370370344e-8, 'hh:mm:ss.00', '00:00:00.01'],
    [0.9999890046296296, 'hh:mm:ss.0', '23:59:59.0'],
    [0.000010995370370370368, 'hh:mm:ss.0', '00:00:00.0'],
    [5.787037037036825e-9, 'hh:mm:ss.000', '00:00:00.001'],
    [5.787037037036789e-9, 'hh:mm:ss.000', '00:00:00.000'],
    [0, '[DBNum1]General ss.000', '0.500000000000018 00.000'],
    [0.00001157986111111111, 'ss.000', '01.000'],
  ];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [v, code, expected]] of cases.entries()) {
    wb.setCells(id, [{ r, c: 0, cell: { v, s: { fmt: 'custom', code } } }]);
    expect(wb.getDisplay(id, r, 0)).toBe(expected);
    const html = cellsToHtml([[expected]], [[wb.getCell(id, r, 0)]], null, [[v]])
      .replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(pasted.v).toBe(v);
    expect(pasted.s.code).toBe(code);
  }
  wb.setInput(id, 0, 0, 0.25, { literal: true });
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(cases[0][0]);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => {
    const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob);
  });
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'fractions.xlsx');
  for (const [r, [value, code, expected]] of cases.entries()) {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(expected);
  }
});
