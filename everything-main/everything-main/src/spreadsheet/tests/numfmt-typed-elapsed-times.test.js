import { describe, expect, it } from 'vitest';
import { parseInput, parseTime } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

const DAY = 86400;

// An elapsed time up to 9999:59:59 is taken as a number, the days it lasts, and shown under [h]:mm:ss.
describe('an elapsed time of 24 hours or more', () => {
  it.each([
    ['24:00', 24 * 3600, '24:00:00'],
    ['25:30', 25 * 3600 + 30 * 60, '25:30:00'],
    ['25:5', 25 * 3600 + 5 * 60, '25:05:00'],
    ['100:00:30', 100 * 3600 + 30, '100:00:30'],
    ['9999:59:59', 9999 * 3600 + 59 * 60 + 59, '9999:59:59'],
  ])('typed as %s is the days it lasts, shown as a duration', (text, seconds, shown) => {
    expect(parseInput(text)).toEqual({ v: seconds / DAY, f: null, fmt: 'custom', code: '[h]:mm:ss' });
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, text);
    expect(wb.getCell(id, 0, 0)).toEqual({ v: seconds / DAY, f: null, s: { fmt: 'custom', code: '[h]:mm:ss' } });
    expect(wb.getDisplay(id, 0, 0)).toBe(shown);
  });

  it('stays text past 9999 hours or with AM or PM, and carries minutes or seconds past 59 over', () => {
    for (const text of ['10000:00', '25:30 pm', '24:00a', '25:30:']) expect(parseInput(text)).toEqual({ v: text, f: null, fmt: null });
    expect(parseInput('25:70')).toEqual({ v: (26 * 3600 + 10 * 60) / DAY, f: null, fmt: 'custom', code: '[h]:mm:ss' });
    expect(parseInput('25:30:60')).toEqual({ v: (25 * 3600 + 31 * 60) / DAY, f: null, fmt: 'custom', code: '[h]:mm:ss' });
  });

  it('is a number to formulas as it is to a typed cell, while TIMEVALUE keeps only the time of day', () => {
    expect(calc('"24:00"+0')).toBe(1);
    expect(calc('"25:30"+0')).toBe(1.0625);
    expect(calc('VALUE("25:30")')).toBe(1.0625);
    expect(calc('HOUR("25:30")')).toBe(1);
    expect(calc('TIMEVALUE("25:30")')).toBe(0.0625);
    expect(calc('TIMEVALUE("24:00")')).toBe(0);
  });

  it('leaves a time of day as it was, elapsed hours being a reading the caller asks for', () => {
    expect(parseTime('23:59')).toBe((23 * 3600 + 59 * 60) / DAY);
    expect(parseTime('25:30')).toBeNull();
    expect(parseTime('25:30', { elapsed: true })).toBe(1.0625);
    expect(parseInput('12:30')).toEqual({ v: (12 * 3600 + 30 * 60) / DAY, f: null, fmt: 'time' });
    expect(parseInput('1:2:3')).toEqual({ v: (3600 + 120 + 3) / DAY, f: null, fmt: 'time', sec: true });
    expect(parseInput('23:59:59')).toEqual({ v: (DAY - 1) / DAY, f: null, fmt: 'time', sec: true });
  });
});
