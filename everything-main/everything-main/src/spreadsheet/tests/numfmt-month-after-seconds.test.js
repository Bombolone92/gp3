import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

const noon = ymdToSerial(2024, 3, 5) + 0.5; // 2024-03-05 12:00:00
const afterNoon = noon + 125 / 86400; // 12:02:05

it.each([
  [noon, 'hh:mm:ss mm/dd/yyyy', '12:00:00 03/05/2024'],
  [noon, 'h:mm:ss m/d', '12:00:00 3/5'],
  [afterNoon, 'ss m', '05 2'],
  [afterNoon, 'ss:mm', '05:02'],
  [afterNoon, 'ss mmm', '05 Mar'],
  [afterNoon, 'mm:ss mm', '02:05 03'],
  [afterNoon, '[s] m', '5 7920'],
  [afterNoon, 'hh:mm:ss.00 mm', '12:02:05.00 03'],
  // m stays minutes right after an hour or right before seconds.
  [afterNoon, 'mm:ss', '02:05'],
  [afterNoon, 'h:mm', '12:02'],
  [afterNoon, 'h"h"mm', '12h02'],
  [1.5, '[h]:mm', '36:00'],
  [afterNoon, 'yyyy-mm-dd hh:mm:ss', '2024-03-05 12:02:05'],
  [afterNoon, 'hh:mm:ss AM/PM m', '12:02:05 PM 3'],
])('resolves minutes and later calendar months for %s in %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('formats a date after a time in TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, String(noon));
  wb.setInput(id, 0, 1, '=TEXT(A1,"hh:mm:ss mm/dd/yyyy")');
  expect(wb.getValue(id, 0, 1)).toBe('12:00:00 03/05/2024');
});
