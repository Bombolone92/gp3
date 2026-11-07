import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

const morning = 0.1; // 02:24
const afternoon = 0.6; // 14:24

it.each([
  // A/P takes the case of its own letters.
  [afternoon, 'h:mm a/p', '2:24 p'],
  [morning, 'h:mm a/p', '2:24 a'],
  [afternoon, 'h:mm A/P', '2:24 P'],
  [morning, 'h:mm A/P', '2:24 A'],
  [afternoon, 'h:mm A/p', '2:24 p'],
  [morning, 'h:mm A/p', '2:24 A'],
  [afternoon, 'h:mm a/P', '2:24 P'],
  // AM/PM is upper case however the code writes it.
  [afternoon, 'h:mm am/pm', '2:24 PM'],
  [morning, 'h:mm am/pm', '2:24 AM'],
  [afternoon, 'h:mm AM/PM', '2:24 PM'],
  [afternoon, 'h:mm Am/Pm', '2:24 PM'],
  // The marker still switches the hour to a 12-hour clock.
  [0.5, 'h a/p', '12 p'],
  [0, 'h a/p', '12 a'],
  [0.5, 'hh:mm:ss a/p', '12:00:00 p'],
  [afternoon, 'a/p h', 'p 2'],
])('prints the meridiem of %s with %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
});

it('uses the code case in cell display and TEXT', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '0.6');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: 'h:mm a/p' });
  wb.setInput(id, 0, 1, '=TEXT(A1,"h:mm a/p")');
  wb.setInput(id, 0, 2, '=TEXT(A1,"h:mm am/pm")');
  expect(wb.getDisplay(id, 0, 0)).toBe('2:24 p');
  expect(wb.getValue(id, 0, 1)).toBe('2:24 p');
  expect(wb.getValue(id, 0, 2)).toBe('2:24 PM');
});
