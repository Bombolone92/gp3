import { expect, it } from 'vitest';
import native from './fixtures/reference-format-spacing-text.json';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

// There are two distinct outputs: cells lay out _x as a glyph-width
// blank and *x as repeated fill; TEXT emits one space for _x and omits *x.
// These saved native formula results protect the latter while visual layout
// gains a separate representation. They do not check the visual layout.
it.each(native.cases)('retains native TEXT output for $label', ({ value, code, expected, length }) => {
  expect(formatWithCode(value, code, { textFunction: true })).toBe(expected);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: value, s: { fmt: 'custom', code } } }]);
  wb.setInput(id, 0, 1, `=TEXT(A1,"${code.replaceAll('"', '""')}")`);
  wb.setInput(id, 0, 2, '=LEN(B1)');
  expect(wb.getValue(id, 0, 1)).toBe(expected);
  expect(wb.getValue(id, 0, 2)).toBe(length);
  // Neither display width nor font/weight may affect the formula result.
  wb.setColWidth(id, 0, 280);
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { font: 'arial', size: 22, bold: true });
  expect(wb.getValue(id, 0, 1)).toBe(expected);
  expect(wb.getValue(id, 0, 2)).toBe(length);
});
