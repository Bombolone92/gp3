import { afterEach, expect, it } from 'vitest';
import { LOCALES, formatValue, parseInput, setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile } from '../src/core/io.js';

// The app's own Feb-24 display is written 2月-24 in Japanese, Chinese and Korean, and no typed entry could
// read a month written with its own number, so such a cell came back from a CSV or a paste as text. A month
// spelled that way is now read like any other, and a number after a month name that no day could be is the
// year, so Feb 99 is February 1999 rather than text.
afterEach(() => setLocale('en-US'));

it.each(LOCALES.map(([locale]) => locale))('reads its own month-and-year display back as a date under %s', (locale) => {
  setLocale(locale);
  const shown = formatValue(ymdToSerial(2024, 2, 1), { fmt: 'custom', code: 'mmm-yy' });
  const back = parseInput(shown);
  // February, reading Feb-24 as the twenty-fourth of the month in the current year.
  expect(back).toEqual({ v: ymdToSerial(new Date().getFullYear(), 2, 24), f: null, fmt: 'date', dateStyle: 'medium' });
});

it.each(['2月-24', '2月 2024', '2月-2024'])('reads a month written with its own number, %s, under Japanese', (text) => {
  setLocale('ja-JP');
  expect(typeof parseInput(text).v).toBe('number');
});

it('reads a two-digit year no day could be as the year', () => {
  expect(parseInput('Feb 99')).toEqual({ v: ymdToSerial(1999, 2, 1), f: null, fmt: 'custom', code: 'mmm-yy' });
  expect(parseInput('Feb-99').v).toBe(ymdToSerial(1999, 2, 1));
  expect(parseInput('Feb 32').v).toBe(ymdToSerial(1932, 2, 1));
  // A number a day could be stays the day, and an impossible one stays text.
  expect(parseInput('Feb 24').fmt).toBe('date');
  expect(parseInput('Feb 31').v).toBe('Feb 31');
});

it('carries a Korean month-and-year cell through a CSV export and import', async () => {
  setLocale('ko-KR');
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2월 2024');
  expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'custom', code: 'mmm-yy' });
  const csv = `period\n${wb.getDisplay(id, 0, 0)}\n`;
  const imported = await workbookFromFile(new TextEncoder().encode(csv), 'periods.csv');
  expect(typeof imported.getValue(imported.activeSheetId, 1, 0)).toBe('number');
});
