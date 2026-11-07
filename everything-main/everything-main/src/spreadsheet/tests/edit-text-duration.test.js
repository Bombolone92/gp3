import { afterEach, expect, it } from 'vitest';
import { editText, formatValue, parseInput, setLocale } from '../src/core/format.js';
import { DURATION_CODE } from '../src/ui/toolbar.js';
import { Workbook } from '../src/core/workbook.js';

// A Duration cell opened for editing showed the days it stores rather than the hours it shows, so 25:30:00
// read 1.0625 in the formula bar and in the cell. The clock reading cannot hold a time past a day, so the
// code's own text is offered instead, whenever a typed entry reads it back as exactly the same value.
afterEach(() => setLocale('en-US'));

it.each([
  ['25:30', '[h]:mm:ss', '25:30:00'],
  ['36:00', '[h]:mm:ss', '36:00:00'],
  ['100:00:30', '[h]:mm:ss', '100:00:30'],
])('edits a typed elapsed time %s as the duration it shows', (typed, code, shown) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, typed);
  const cell = wb.getCell(id, 0, 0);
  expect(cell.s).toMatchObject({ fmt: 'custom', code });
  expect(wb.getDisplay(id, 0, 0)).toBe(shown);
  expect(editText(cell)).toBe(shown);
  // What the editor offers reads back as exactly the value that was there, so Enter changes nothing.
  expect(parseInput(editText(cell)).v).toBe(cell.v);
});

it('edits the toolbar\'s Duration preset, and an hours-and-minutes code, the same way', () => {
  expect(editText({ v: 1.0625, s: { fmt: 'custom', code: DURATION_CODE } })).toBe('25:30:00');
  expect(editText({ v: 1.5, s: { fmt: 'custom', code: '[h]:mm' } })).toBe('36:00');
  setLocale('de-DE');
  expect(editText({ v: 1.0625, s: { fmt: 'custom', code: DURATION_CODE } })).toBe('25:30:00');
});

it('keeps the raw number where the code\'s text cannot be read back as the same value', () => {
  // Past the four-digit hour a typed elapsed time stops at, and for a value the shown seconds round.
  expect(formatValue(10000.5, { fmt: 'custom', code: '[h]:mm:ss' })).toBe('240012:00:00');
  expect(editText({ v: 10000.5, s: { fmt: 'custom', code: '[h]:mm:ss' } })).toBe('10000.5');
  expect(editText({ v: 1.234, s: { fmt: 'custom', code: '[h]:mm:ss' } })).toBe('1.234');
});

it('leaves a custom date, time or fraction code editing as it did', () => {
  expect(editText({ v: 45000, s: { fmt: 'custom', code: 'dd/mm/yyyy' } })).toBe('2023-03-15');
  expect(editText({ v: 45000, s: { fmt: 'custom', code: 'dddd, mmmm d' } })).toBe('2023-03-15');
  expect(editText({ v: 0.0625, s: { fmt: 'custom', code: 'h:mm:ss' } })).toBe('01:30:00');
  expect(editText({ v: 1.5, s: { fmt: 'custom', code: '# ?/?' } })).toBe('1.5');
});
