// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode, formatCodeError } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

// Controls measured in desktop Excel: signed 16-bit denominator encoding, including the
// literal text retained when that encoding wraps into variable precision.
const native = [
  [.5, '?/32768', '16384/32768'], [.5, '?/32769', '1/3    '],
  [.123456789, '?/32769', '10/32   '], [.123456789, '?/65535', '1/6    '],
  [.123456789, '?/65536', '10/65   '], [.123456789, '?/65537', '0/6    '],
  [.5, '?/98303', '16384/98303'], [.5, '?/98304', '16384/98304'],
  [.123456789, '?/99999', '10/99   '],
  [0, '# ?/65535', '0        '], [1e20, '# ?/65535', '100000000000000000000        '],
  [1.000015259254738, '# ?/32767', '1        '],
  [1.15, '# ?/10', '1 1/10'], [2.15, '# ?/10', '2 1/10'],
];
it.each(native)('matches native literal arithmetic at %s with %s', (value, code, expected) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(value, code)).toBe(expected);
});

it('bounds the rounded fixed numerator before a mixed fraction can carry', () => {
  for (const d of [1, 2, 8, 16, 99, 32767, 32768]) {
    for (const sign of [1, -1]) {
      expect(formatWithCode(sign * 32767 / d, `?/${d}`)).toBe(`${sign < 0 ? '-' : ''}32767/${d}`);
      expect(formatWithCode(sign * 32767.5 / d, `?/${d}`, { overflow: null })).toBeNull();
      expect(formatWithCode(sign * 32768 / d, `?/${d}`)).toBe('#####');
    }
  }
  expect(formatWithCode(32767.5 / 32768, '# ?/32768', { overflow: null })).toBeNull();
  expect(formatWithCode(1, '# ?/32768')).toBe('1        ');
  expect(formatWithCode(4095.9375, '# ?/8')).toBe('4096    ');
  expect(formatWithCode(1e20, '# ?/8')).toBe('100000000000000000000    ');
});

it('preserves sign, sections, percent scaling and labels without changing literal encoding', () => {
  expect(formatWithCode(-.5, '?/65535')).toBe('-1/6    ');
  expect(formatWithCode(-.5, '?/65535;(?/65535)')).toBe('(1/6    )');
  expect(formatWithCode(.005, '??/65535%')).toBe(' 1/6    %');
  expect(formatWithCode(.5, '?/"of"65535" units"')).toBe('1/of6     units');
  expect(formatWithCode(-.123456789, '?/65537')).toBe('0/6    ');
  expect(formatWithCode(1.25, '# ?/10')).toBe('1 3/10');
});

it('rejects six-digit literal fields consistently, including zero and huge integers', () => {
  for (const d of ['100000', '999999', '9007199254740993', '9'.repeat(200)]) {
    const code = `?/${d}`;
    expect(formatCodeError(code)).toBeTruthy();
    for (const v of [0, .5, -2.75]) expect(formatWithCode(v, code, { overflow: null })).toBeNull();
  }
  expect(formatCodeError('?/99999')).toBeNull();
  expect(formatWithCode(.5, '?/8"100000"')).toBe('4/8100000');
});

it('retains raw numbers and literal formats through edit, clipboard and metadata-free XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const rows = [...native, [4096, '?/8', null], [1, '?/32768', null]];
  rows.forEach(([v, code, expected], r) => {
    wb.setInput(id, r, 0, String(v)); wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code}")`);
    expect(wb.getValue(id, r, 1)).toEqual(expected ?? { error:'#VALUE!' });
    const cell = wb.getCell(id, r, 0), display = wb.getDisplay(id, r, 0);
    const html = cellsToHtml([[display]], [[cell]], null, [[v]]);
    expect(parseHtmlClipboard(html).cells[0][0].v).toBe(v);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(v); expect(pasted.s.code).toBe(code);
  });
  wb.setInput(id, 0, 0, '1'); expect(wb.getValue(id, 0, 1)).toEqual({ error:'#VALUE!' }); wb.undo();
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'native.xlsx');
  rows.forEach(([v, code, expected], r) => {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(v);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toEqual(expected ?? { error:'#VALUE!' });
  });
});
