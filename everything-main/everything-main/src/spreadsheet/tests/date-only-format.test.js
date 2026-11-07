import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  ['yyyy-mm-dd', '2024-12-31', '2025-01-01'],
  ['dd/mm/yyyy', '31/12/2024', '01/01/2025'],
  ['mmmm', 'December', 'January'],
  ['dddd', 'Tuesday', 'Wednesday'],
  ['yyyy', '2024', '2025'],
  ['dd/mm/yyyy "hh:mm:ss"', '31/12/2024 hh:mm:ss', '01/01/2025 hh:mm:ss'],
])('rounds date fields at the half-second boundary with %s', (code, expected, carried) => {
  const day = ymdToSerial(2024, 12, 31);
  for (const seconds of [0, 43200, 86369, 86370, 86399, 86399.999]) {
    expect(formatWithCode(day + seconds / 86400, code)).toBe(seconds < 86399.5 ? expected : carried);
  }
});

it.each([
  [2024, 2, 28, '28/02/2024'],
  [2024, 2, 29, '29/02/2024'],
  [2023, 2, 28, '28/02/2023'],
  [9999, 12, 31, '31/12/9999'],
])('keeps month boundaries and the final valid date at %s-%s-%s', (y, m, d, expected) => {
  expect(formatWithCode(ymdToSerial(y, m, d) + 86399 / 86400, 'dd/mm/yyyy')).toBe(expected);
});

it('uses seconds for clock rounding and explicit fractional precision', () => {
  const day = ymdToSerial(2024, 12, 31);
  expect(formatWithCode(day + 86399 / 86400, 'yyyy-mm-dd hh:mm')).toBe('2024-12-31 23:59');
  expect(formatWithCode(day + 86399.9996 / 86400, 'yyyy-mm-dd hh:mm:ss.000')).toBe('2025-01-01 00:00:00.000');
  expect(formatWithCode(86399 / 86400, '[h]:mm')).toBe('23:59');
});

it('agrees with named date formats in cells and TEXT formulas without changing the timestamp', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const value = ymdToSerial(2024, 12, 31) + 86399 / 86400;
  wb.setInput(id, 0, 0, value, { literal: true });
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'date' });
  const display = wb.getDisplay(id, 0, 0);
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: 'yyyy-mm-dd' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"yyyy-mm-dd")');
  expect(wb.getDisplay(id, 0, 0)).toBe(display);
  expect(wb.getValue(id, 0, 1)).toBe(display);
  expect(wb.getValue(id, 0, 0)).toBe(value);
});
