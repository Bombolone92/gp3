import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

const previous = getLocale();
afterEach(() => setLocale(previous));

it.each([
  [5, '0.#', '5.'],
  [5.25, '0.#', '5.3'],
  [-5, '0.#', '-5.'],
  [0, '#.##', '.'],
  [0.5, '#.##', '.5'],
  [1, '0.###', '1.'],
  [1234, '#,##0.##', '1,234.'],
  [5, '0.', '5.'],
  [5, '0.#" kg"', '5. kg'],
  [0.5, '0.#%', '50.%'],
  [1200, '0.#E+00', '1.2E+03'],
  [1000, '0.#E+00', '1.E+03'],
  [5, '0.#;(0.#)', '5.'],
  [-5, '0.#;(0.#)', '(5.)'],
  [1e21, '0.#', '1000000000000000000000.'],
  // Codes without optional decimals are unchanged.
  [5, '0.00', '5.00'],
  [5, '0', '5'],
  [5, '#', '5'],
  [0, '#', ''],
])('keeps the decimal point of %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('prints the trailing point as the locale decimal mark', () => {
  setLocale('de-DE');
  expect(formatWithCode(5, '0.#')).toBe('5,');
  expect(formatWithCode(1234, '#,##0.##')).toBe('1.234,');
});

it('shows the point in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0.#' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"0.#")');
  expect(wb.getDisplay(id, 0, 0)).toBe('5.');
  expect(wb.getValue(id, 0, 1)).toBe('5.');
  expect(wb.getValue(id, 0, 0)).toBe(5);
});
