import { expect, it } from 'vitest';
import { formatWithCode, codeColor, codeDateKind } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each([
  ['0.0;"Text: "@', -5, '-5.0'],
  ['0.0;"Text: "@', 0, '0.0'],
  ['0.0;"Text: "@', 5, '5.0'],
  ['0.0;"Text: "@', 'hello', 'Text: hello'],
  ['0.0;(0.00);"Text: "@', -5, '(5.00)'],
  ['0.0;(0.00);"Text: "@', 0, '0.0'],
  ['0.0;(0.00);"Text: "@', 'hello', 'Text: hello'],
  ['"Text: "@', 5, '5'],
  ['"Text: "@', -5, '-5'],
  ['"Text: "@', 0, '0'],
  ['0.0;"@"', -5, '@'],
  ['0.0;\\@', -5, '@'],
  ['0.0;"@"', 'hello', 'hello'],
  ['0.0;(0.00);"@"', 0, '@'],
])('selects the proper section of %s for %s', (code, value, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('selects colors and date semantics from the same numeric and text sections', () => {
  const code = '[Blue]0;[Red](0);[Green]@';
  expect(codeColor(0, code)).toBe('#0000ff');
  expect(codeColor(-5, code)).toBe('#ff0000');
  expect(codeColor('hello', code)).toBe('#00ff00');
  expect(codeColor(5, '[Red]@')).toBeNull();
  expect(codeDateKind(0, 'yyyy-mm-dd;@')).toBe('date');
  expect(codeDateKind('hello', 'yyyy-mm-dd;@')).toBeNull();
});

it('keeps text sections out of conditional numeric fallbacks', () => {
  expect(formatWithCode(-5, '[>100]0.0;"Text: "@')).toBe('-5');
  expect(formatWithCode(5, '[>100]0.0;[<-100]0.00;"Text: "@')).toBe('#####');
  expect(formatWithCode('hello', '[>100]0.0;[<-100]0.00;"Text: "@')).toBe('Text: hello');
});

it('preserves short text formats in cells, TEXT formulas, and XLSX files', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, value] of [-5, 0, 'hello'].entries()) wb.setInput(id, r, 0, value, { literal: true });
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { fmt: 'custom', code: '0.0;"Text: "@' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0.0;@")');
  expect([0, 1, 2].map((r) => wb.getDisplay(id, r, 0))).toEqual(['-5.0', '0.0', 'Text: hello']);
  expect(wb.getValue(id, 0, 1)).toBe('-5.0');
  const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'text-sections.xlsx');
  expect([0, 1, 2].map((r) => back.getDisplay(back.activeSheetId, r, 0))).toEqual(['-5.0', '0.0', 'Text: hello']);
  expect([0, 1, 2].map((r) => back.getValue(back.activeSheetId, r, 0))).toEqual([-5, 0, 'hello']);
});
