import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [2.75, '$ ??/??', '$ 11/4 '],
  [-2.75, '$ ??/??', '-$ 11/4 '],
  [2.75, ' ??/??', ' 11/4 '],
  [2.75, '_x??/??', ' 11/4 '],
  [2.75, '"USD" ??/??', 'USD 11/4 '],
  [2.75, '"USD "??/??', 'USD 11/4 '],
  [2.75, '"USD"\\ ??/??', 'USD 11/4 '],
  [2.75, '$ ??/8', '$ 22/8'],
  [2.75, '_x??/16', ' 44/16'],
  [0, '$ ??/8', '$  0/8'],
  [2, '$ ??/??', '$  2/1 '],
  [1.99, '$ ??/?', '$  2/1'],
  [0.0275, '% ??/??', '% 11/4 '],
  [-2.75, '??/??;[Red]($ ??/??)', '($ 11/4 )'],
  [2.75, '$ ??/??" units"', '$ 11/4  units'],
  [2.75, '$ # ??/??', '$ 2  3/4 '],
  [2.75, '_x# ??/16', ' 2 12/16'],
  [2.75, '$ #\\ ??/??', '$ 2  3/4 '],
  [2.75, '$ #" "??/??', '$ 2  3/4 '],
  [2.75, '$ #_)??/??', '$ 2  3/4 '],
  [0.75, '$ ??/??', '$  3/4 '],
])('distinguishes prefix spaces from a whole-part separator for %s in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('does not let prefix labels change the fraction form in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2.75');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '$ ??/??' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"$ ??/??")');
  expect(wb.getDisplay(id, 0, 0)).toBe('$ 11/4 ');
  expect(wb.getValue(id, 0, 1)).toBe('$ 11/4 ');
  expect(wb.getValue(id, 0, 0)).toBe(2.75);
});
