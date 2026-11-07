import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each([
  [2.75, '" "# ?/?" "', ' 2 3/4 '],
  [2.75, '_x# ?/?_)', ' 2 3/4 '],
  [2.75, '" "??/??', ' 11/4 '],
  [2.75, '??/??" "', '11/4  '],
  [2.75, '\\ # ?/?\\ ', ' 2 3/4 '],
  [2.75, '"\t"# ?/?"\t"', '\t2 3/4\t'],
  [2.75, '"\u00a0"# ?/?"\u00a0"', '\u00a02 3/4\u00a0'],
  [2.75, '# ?/8" "', '2 6/8 '],
  [2.75, '_x??/16_)', ' 44/16 '],
  [1.99, '" "# ?/?" "', ' 2     '],
  [0, '" "# ?/?" "', ' 0     '],
  [2, '" "# ?/?" "', ' 2     '],
  [0.75, '" "# ?/?" "', '  3/4 '],
  [-2.75, '# ?/?;[Red]" ("# ?/?") "', ' (2 3/4) '],
  [0.0125, '# ?/?%_)" "', '1 1/4%  '],
  [2.75, '" USD "# ?/?" kg "', ' USD 2 3/4 kg '],
  [2.75, '# ?/?', '2 3/4'],
  [0.75, '# ?/?', ' 3/4'],
])('preserves fraction affix whitespace for %s in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('preserves explicit fraction padding in cell display, TEXT, and XLSX', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2.75');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '_x# ?/?_)' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"_x# ?/?_)")');
  expect(wb.getDisplay(id, 0, 0)).toBe(' 2 3/4 ');
  expect(wb.getValue(id, 0, 1)).toBe(' 2 3/4 ');
  expect(wb.getValue(id, 0, 0)).toBe(2.75);

  const imported = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'padding.xlsx');
  expect(imported.getDisplay(imported.activeSheetId, 0, 0)).toBe(' 2 3/4 ');
  expect(imported.getValue(imported.activeSheetId, 0, 1)).toBe(' 2 3/4 ');
  expect(imported.getValue(imported.activeSheetId, 0, 0)).toBe(2.75);
});
