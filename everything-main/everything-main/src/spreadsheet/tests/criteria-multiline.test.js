import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { criteriaMatcher } from '../src/core/formula/functions.js';

it.each([
  ['COUNTIF(A1:A3,"*")', 3],
  ['COUNTIF(A1:A3,"a?b")', 2],
  ['SUMIF(A1:A3,"a*b",B1:B3)', 30],
  ['COUNTIF(A1:A3,"a~*b")', 0],
])('matches multiline cell text with %s', (formula, expected) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'a\nb' } }, { r: 0, c: 1, cell: { v: 10 } },
    { r: 1, c: 0, cell: { v: 'a\rb' } }, { r: 1, c: 1, cell: { v: 20 } },
    { r: 2, c: 0, cell: { v: 'other\ntext' } }, { r: 2, c: 1, cell: { v: 30 } },
  ]);
  wb.setInput(id, 0, 3, `=${formula}`);
  expect(wb.getValue(id, 0, 3)).toBe(expected);
});

it('does not treat a trailing newline as the end of a literal wildcard match', () => {
  expect(criteriaMatcher('a~?')('a?')).toBe(true);
  expect(criteriaMatcher('a~?')('a?\n')).toBe(false);
  expect(criteriaMatcher('a?')('a\n')).toBe(true);
  expect(criteriaMatcher('a?')('ab\n')).toBe(false);
});
