import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  // A whole result blanks the fraction's ? placeholders and slash to their width.
  [1.99, '# ?/?', '2    '],
  [0.99, '# ?/?', '1    '],
  [-1.99, '# ?/?', '-2    '],
  [1.999, '# ??/??', '2      '],
  [1.9999, '# ???/???', '2        '],
  [1.99999, '# ????/????', '2          '],
  [0.99, '0 ?/?', '1    '],
  [-1.99, '# ?/?;(# ?/?)', '(2    )'],
  [1.99, '# ?/? "kg"', '2     kg'],
  [1.99, '"$"# ?/?', '$2    '],
  [0.99, '# ?/?;(# ?/?);"zero"', '1    '],
  [2 - Number.EPSILON, '# ?/?????', '2        '],
  [2 - Number.EPSILON, '# ?/????????????', `2${' '.repeat(15)}`],
  [1.875, '# ?/????????????', `1 7/8${' '.repeat(11)}`],
  [1.9, '# ?/?', '1 8/9'],
  [2, '# ?/?', '2    '],
  [0, '# ?/?', '0    '],
  [1.99, '?/?', '2/1'],
  [0.99, '?/?', '1/1'],
])('carries rounded mixed fractions for %s in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('normalizes mixed fraction carry in cell display and TEXT while preserving the stored value', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1.99');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '# ?/?' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"# ?/?")');
  expect(wb.getDisplay(id, 0, 0)).toBe('2    ');
  expect(wb.getValue(id, 0, 1)).toBe('2    ');
  expect(wb.getValue(id, 0, 0)).toBe(1.99);
});
