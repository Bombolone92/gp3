import { afterEach, expect, it } from 'vitest';
import { parseInput, setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

// A typed year of a single digit was refused, so 1/2/3 stayed text where 1/2/03 was a date; both now
// read as dates, through the same 00–29 pivot into the 2000s.
afterEach(() => setLocale('en-US'));

it.each([
  ['1/2/3', 2003, 1, 2], ['1-2-3', 2003, 1, 2], ['1/2/0', 2000, 1, 2], ['1/2/9', 2009, 1, 2], ['12/31/5', 2005, 12, 31],
])('reads %s as a date', (text, y, m, d) => {
  expect(parseInput(text)).toEqual({ v: ymdToSerial(y, m, d), f: null, fmt: 'date' });
});

it('keeps the order and the refusals the longer years have', () => {
  setLocale('en-GB');
  expect(parseInput('1/2/3').v).toBe(ymdToSerial(2003, 2, 1)); // day first
  setLocale('de-DE');
  expect(parseInput('1.2.3').v).toBe(ymdToSerial(2003, 2, 1));
  setLocale('ja-JP');
  expect(parseInput('3/1/1').v).toBe(ymdToSerial(2003, 1, 1)); // year first, as 24/1/1 already was
  setLocale('en-US');
  // Three digits are no year, and an impossible day is still no date.
  expect(parseInput('1/2/003').v).toBe('1/2/003');
  expect(parseInput('31/2/3').v).toBe('31/2/3');
  expect(parseInput('1-2').v).toBe('1-2');
});

it('shows a one-digit year back in a cell', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1/2/3');
  expect(wb.getCell(id, 0, 0)).toEqual({ v: ymdToSerial(2003, 1, 2), f: null, s: { fmt: 'date' } });
  expect(wb.getDisplay(id, 0, 0)).toBe('2003-01-02');
});
