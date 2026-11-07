import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

const cases = [
  [1.25, '# ?/8', '1 2/8'],
  [0.25, '# ?/8', ' 2/8'],
  [1.25, '# ??/16', '1  4/16'],
  [1.25, '# ??/100', '1 25/100'],
  [123.456, '# ?/2', '123 1/2'],
  [123.456, '# ?/4', '123 2/4'],
  [123.456, '# ?/8', '123 4/8'],
  [123.456, '# ??/16', '123  7/16'],
  [123.456, '# ?/10', '123 5/10'],
  [123.456, '# ??/100', '123 46/100'],
  [1.15, '# ?/10', '1 1/10'],
  [2.15, '# ?/10', '2 1/10'],
  [1000000000000000.25, '# ??/100', '1000000000000000 25/100'],
  [1.99, '# ?/8', '2    '],
  [1.99, '# ??/100', '1 99/100'],
  [0, '# ?/8', '0    '],
  [1, '# ?/8', '1    '],
  [1.25, '?/8', '10/8'],
  [0, '?/8', '0/8'],
  [0.25, '# ?/2', ' 1/2'],
  [-1.25, '# ?/8', '-1 2/8'],
  [-1.25, '# ?/8;[Red](# ?/8)', '(1 2/8)'],
  [1.25, '# ?/8" inches"', '1 2/8 inches'],
  [0.0125, '# ?/8%', '1 2/8%'],
  [5, '0"/8"', '5/8'],
  [5, '0\\/8', '5/8'],
];

it.each(cases)('keeps the fixed denominator for %s in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('reports unusable literal denominators as format overflow', () => {
  expect(formatWithCode(0.25, '# ?/9007199254740993')).toBe('#####');
  expect(formatWithCode(-0.25, '# ?/9007199254740993')).toBe('#####');
  expect(formatWithCode(0.25, '# ?/' + '9'.repeat(400))).toBe('#####');
});

it('uses fixed denominators in cell display and TEXT without modifying values', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1.25');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '# ?/8' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"# ?/8")');
  expect(wb.getDisplay(id, 0, 0)).toBe('1 2/8');
  expect(wb.getValue(id, 0, 1)).toBe('1 2/8');
  expect(wb.getValue(id, 0, 0)).toBe(1.25);
});

it('preserves fixed-denominator codes through external XLSX import and export', async () => {
  const sheet = XLSX.utils.aoa_to_sheet(cases.map(([v, z]) => [{ t: 'n', v, z }]));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Fractions');
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'fractions.xlsx');
  for (const [r, [value, , expected]] of cases.entries()) {
    expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(value);
    expect(wb.getDisplay(wb.activeSheetId, r, 0)).toBe(expected);
  }
  const exported = XLSX.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array', cellNF: true });
  for (const [r, [value, code]] of cases.entries()) {
    expect(exported.Sheets.Fractions[`A${r + 1}`].v).toBe(value);
    expect(exported.Sheets.Fractions[`A${r + 1}`].z).toBe(code);
  }
});
