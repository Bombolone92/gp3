import { afterEach, expect, it } from 'vitest';
import { parseInput, setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

// An hour with AM or PM and no minutes has been a time since "3 pm" was read on its own, but a date and time
// still needed the minutes, so "9/15/2026 3 PM" stayed text beside a "3 pm" that was 15:00.
const SEP_15 = ymdToSerial(2026, 9, 15);
afterEach(() => setLocale('en-US'));

it.each(['9/15/2026 3 PM', '9/15/2026 3PM', '9/15/2026 3 p', '2026-09-15 3 pm', 'Sep 15, 2026 3 PM', '2026-09-15T3 PM', '2026-09-15, 3 pm'])(
  'reads %s as the afternoon of 15 September 2026', (text) => {
    expect(parseInput(text)).toEqual({ v: SEP_15 + 0.625, f: null, fmt: 'datetime' });
  },
);

it('reads midnight and keeps what is not a time', () => {
  expect(parseInput('2026-09-15 12 am').v).toBe(SEP_15);
  // A bare a or p counts only after a space, and an hour off the clock is no time, as on their own.
  expect(parseInput('9/15/2026 3p').v).toBe('9/15/2026 3p');
  expect(parseInput('9/15/2026 13 pm').v).toBe('9/15/2026 13 pm');
  expect(parseInput('9/15/2026 3').v).toBe('9/15/2026 3');
  expect(parseInput('Total 5 PM').v).toBe('Total 5 PM');
});

it('reads it in a cell under another regional format too', () => {
  setLocale('de-DE');
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '15.09.2026 3 pm');
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: SEP_15 + 0.625, s: { fmt: 'datetime' } });
});
