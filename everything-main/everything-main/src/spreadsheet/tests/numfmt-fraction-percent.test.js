import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each([
  [0.0125, '# ?/?%', '1 1/4%'],
  [-0.0125, '# ?/?%', '-1 1/4%'],
  [0.0025, '# ?/?%', ' 1/4%'],
  [0.0125, '?/?%', '5/4%'],
  [0, '# ?/?%', '0    %'],
  [0.02, '# ?/?%', '2    %'],
  [0.0199, '# ?/?%', '2    %'],
  [0.0125, '%# ?/?', '%1 1/4'],
  [-0.0125, '%# ?/?', '-%1 1/4'],
  [0.000125, '%# ?/?%', '%1 1/4%'],
  [0.000125, '# ?/?%%', '1 1/4%%'],
  [0.0125, '# ?/?" percent ("%")"', '1 1/4 percent (%)'],
  [-0.0125, '# ?/?%;[Red](# ?/?%)', '(1 1/4%)'],
  [0.0125, '# ?/?%"%"', '1 1/4%%'],
  [0.0125, '# ?/?%\\%', '1 1/4%%'],
  [1.25, '# ?/?"%"', '1 1/4%'],
  [1.25, '# ?/?\\%', '1 1/4%'],
  [1.25, '# ?/?', '1 1/4'],
])('preserves percentage units for %s in fraction format %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('keeps percentage units in cell display, TEXT, and an XLSX round trip', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '0.0125');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '# ?/?%' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"# ?/?%")');
  expect(wb.getDisplay(id, 0, 0)).toBe('1 1/4%');
  expect(wb.getValue(id, 0, 1)).toBe('1 1/4%');
  expect(wb.getValue(id, 0, 0)).toBe(0.0125);

  const imported = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'fractions.xlsx');
  expect(imported.getValue(imported.activeSheetId, 0, 0)).toBe(0.0125);
  expect(imported.getDisplay(imported.activeSheetId, 0, 0)).toBe('1 1/4%');
  expect(imported.getValue(imported.activeSheetId, 0, 1)).toBe('1 1/4%');
});
