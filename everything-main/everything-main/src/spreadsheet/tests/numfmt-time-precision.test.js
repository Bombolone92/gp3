import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { numFmtToStyle, styleToNumFmt, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

it.each([
  [16563.75, 'h:mm:ss.00', '4:36:03.75'],
  [16563.75, 'h:mm:ss.00 AM/PM', '4:36:03.75 AM'],
  [59763.75, 'h:mm:ss.00 AM/PM', '4:36:03.75 PM'],
  [3735.8, '[ss].00', '3735.80'],
  [3735.8, '[m]:ss.000', '62:15.800'],
  [12.3456, 'ss.0000', '#####'],
  [59.9996, 'mm:ss.000', '01:00.000'],
  [3599.9996, 'hh:mm:ss.000', '01:00:00.000'],
  [86399.9996, 'hh:mm:ss.000', '00:00:00.000'],
  [129599.9996, '[h]:mm:ss.000', '36:00:00.000'],
  [129599.9996, '[m]:ss.000', '2160:00.000'],
  [129599.9996, '[s].000', '129600.000'],
  [3599.9, '[h]:mm:ss', '1:00:00'],
  [3599.9, '[m]:ss', '60:00'],
  [59.9, '[s]', '60'],
  [0, 'hh:mm:ss.000', '00:00:00.000'],
  [-1, 'hh:mm:ss.000', '#####'],
])('formats %s seconds with %s', (seconds, code, expected) => {
  expect(formatWithCode(seconds / 86400, code)).toBe(expected);
});

it('carries fractional rounding into the calendar date and AM/PM', () => {
  const day = ymdToSerial(2024, 12, 31);
  expect(formatWithCode(day + 86399.9996 / 86400, 'yyyy-mm-dd hh:mm:ss.000')).toBe('2025-01-01 00:00:00.000');
  expect(formatWithCode(day + 43199.9996 / 86400, 'h:mm:ss.000 AM/PM')).toBe('12:00:00.000 PM');
});

it('keeps quoted decimal digits literal and ordinary decimal formats numeric', () => {
  expect(formatWithCode(12.3456 / 86400, 'ss.000".00"')).toBe('12.346.00');
  expect(formatWithCode(12.3456 / 86400, 'ss".000"')).toBe('12.000');
  expect(formatWithCode(12.3456, '0.000" seconds"')).toBe('12.346 seconds');
});

it('rejects fractional-second precision beyond three digits', () => {
  const zeros = '0'.repeat(200);
  expect(formatWithCode(0.5, `hh:mm:ss.${zeros}`)).toBe('#####');
});

it('uses fractional time codes for cell display and TEXT and preserves them for file export', () => {
  const code = 'hh:mm:ss.000';
  const style = numFmtToStyle(code);
  expect(style).toEqual({ fmt: 'custom', code });
  expect(styleToNumFmt(style)).toBe(code);
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, String(59.9996 / 86400));
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, style);
  wb.setInput(id, 0, 1, '=TEXT(A1,"hh:mm:ss.000")');
  expect(wb.getDisplay(id, 0, 0)).toBe('00:01:00.000');
  expect(wb.getValue(id, 0, 1)).toBe('00:01:00.000');
});
