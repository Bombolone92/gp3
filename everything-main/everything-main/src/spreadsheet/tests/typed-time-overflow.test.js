import { describe, expect, it } from 'vitest';
import { parseInput, parseTime } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

const DAY = 86400;

// A typed time whose minutes or seconds reached sixty (0:90, 1:30:60, 12:60) stayed text. The excess now
// carries over, 0:90 being 1:30 and 1:30:60 being 1:31:00, as this app already did for hours past 23.
describe('a typed time with minutes or seconds past 59', () => {
  it.each([
    ['0:90', 5400, '01:30', { fmt: 'time' }],
    ['12:60', 13 * 3600, '13:00', { fmt: 'time' }],
    ['1:60', 7200, '02:00', { fmt: 'time' }],
    ['1:30:60', 3600 + 31 * 60, '01:31:00', { fmt: 'time', sec: true }],
    ['1:5:60', 3600 + 6 * 60, '01:06:00', { fmt: 'time', sec: true }],
    ['0:90:90', 5490, '01:31:30', { fmt: 'time', sec: true }],
    ['13:30:60.5', 13 * 3600 + 31 * 60 + 0.5, '13:31:01', { fmt: 'time', sec: true }],
  ])('carries the excess over: %s is %s seconds, shown as %s', (text, seconds, display, style) => {
    expect(parseInput(text)).toEqual({ v: seconds / DAY, f: null, ...style });
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, text);
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe(display);
  });

  it('runs into the next day as an elapsed time, the way 24:00 does', () => {
    expect(parseInput('23:60')).toEqual({ v: 1, f: null, fmt: 'custom', code: '[h]:mm:ss' });
    expect(parseInput('25:70')).toEqual({ v: (25 * 3600 + 70 * 60) / DAY, f: null, fmt: 'custom', code: '[h]:mm:ss' });
    expect(parseInput('25:30:60')).toEqual({ v: (25 * 3600 + 31 * 60) / DAY, f: null, fmt: 'custom', code: '[h]:mm:ss' });
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '25:70');
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe('26:10:00');
  });

  it('keeps a clock reading with AM or PM strict, as no clock shows 1:75', () => {
    for (const text of ['1:75 PM', '12:60 AM', '1:30:60 pm', '1:90p']) expect(parseInput(text)).toEqual({ v: text, f: null, fmt: null });
  });

  it('reads the time after a date, within the day', () => {
    expect(parseInput('2024-01-15 0:90')).toEqual({ v: 45306 + 1.5 / 24, f: null, fmt: 'datetime' });
    expect(parseInput('2024-01-15 23:60').v).toBe('2024-01-15 23:60'); // a time of day does not spill into the next date
    expect(parseTime('23:60')).toBeNull();
    expect(parseTime('23:60', { elapsed: true })).toBe(1);
    expect(parseTime('0:90')).toBe(1.5 / 24);
  });

  it('reads the same way in TIMEVALUE and arithmetic on text', () => {
    expect(calc('TIMEVALUE("0:90")')).toBeCloseTo(1.5 / 24, 12);
    expect(calc('TIMEVALUE("25:70")')).toBeCloseTo((2 * 3600 + 10 * 60) / DAY, 12); // 26:10 wraps around the day
    expect(calc('"1:30:60"+0')).toBeCloseTo((3600 + 31 * 60) / DAY, 12);
    expect(calc('TIMEVALUE("1:75 PM")')).toEqual({ error: '#VALUE!' });
  });
});
