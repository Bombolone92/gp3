import { describe, expect, it } from 'vitest';
import { parseInput, parseTime } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

describe('fractional seconds', () => {
  it.each([
    ['13:30:00.5', 48600.5],
    ['0:00:00.25', 0.25],
    ['1:30:00.5 PM', 48600.5],
    ['09:05:30.125', 32730.125],
    ['23:59:59.999', 86399.999],
  ])('reads %s as a time with seconds', (text, seconds) => {
    expect(parseInput(text)).toEqual({ v: seconds / 86400, f: null, fmt: 'time', sec: true });
    expect(parseTime(text)).toBe(seconds / 86400);
  });

  it('carries seconds that reach sixty into the minute, and rejects a bare decimal point', () => {
    expect(parseInput('13:30:60.5').v).toBe((13 * 3600 + 31 * 60 + 0.5) / 86400);
    expect(parseInput('13:30:59.').v).toBe('13:30:59.');
    expect(parseInput('13:30.5').v).toBe('13:30.5');
  });

  it('reads them after a date and in TIMEVALUE, and shows them under a subsecond code', () => {
    expect(parseInput('2024-01-15 13:30:00.5')).toMatchObject({ fmt: 'datetime' });
    expect(parseInput('2024-01-15 13:30:00.5').v).toBeCloseTo(45306 + 48600.5 / 86400, 10);
    expect(calc('TIMEVALUE("13:30:00.5")')).toBeCloseTo(48600.5 / 86400, 12);
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '13:30:00.25');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'time', sec: true });
    expect(wb.getDisplay(id, 0, 0)).toBe('13:30:00');
    wb.applyStyle(id, parseRange('A1'), { fmt: 'custom', code: 'h:mm:ss.00' });
    expect(wb.getDisplay(id, 0, 0)).toBe('13:30:00.25');
  });
});

describe('single-digit minutes and seconds', () => {
  it.each([
    ['1:5', 3900, '01:05', { fmt: 'time' }],
    ['10:5', 36300, '10:05', { fmt: 'time' }],
    ['1:5:7', 3907, '01:05:07', { fmt: 'time', sec: true }],
    ['1:05:7', 3907, '01:05:07', { fmt: 'time', sec: true }],
    ['12:3 pm', 43380, '12:03', { fmt: 'time' }],
    ['1:5:7.25', 3907.25, '01:05:07', { fmt: 'time', sec: true }],
  ])('reads %s as %s seconds shown as %s', (text, seconds, display, style) => {
    expect(parseInput(text)).toEqual({ v: seconds / 86400, f: null, ...style });
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, text);
    expect(wb.getCell(wb.activeSheetId, 0, 0).s).toEqual(style);
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe(display);
  });

  it('still keeps three-digit parts text, and carries a sixtieth minute or second over', () => {
    expect(parseInput('12:345').v).toBe('12:345');
    expect(parseInput('1:60').v).toBe(7200 / 86400); // 2:00
    expect(parseInput('1:5:60').v).toBe((3600 + 6 * 60) / 86400); // 1:06:00
    expect(parseInput('25:5').v).toBe((25 * 3600 + 5 * 60) / 86400); // an elapsed time, 25:05:00, not a ratio
    expect(parseInput('1:5 pm').v).toBe(47100 / 86400);
    expect(parseInput('2024-01-15 1:5').v).toBe(45306 + 3900 / 86400);
  });
});

describe('a bare a or p after the time', () => {
  it.each([
    ['1:30p', 48600, {}],
    ['1:30 a', 5400, {}],
    ['1:30P', 48600, {}],
    ['1:30 A', 5400, {}],
    ['12:00a', 0, {}],
    ['12:00 p', 43200, {}],
    ['11:59:30p', 86370, { sec: true }],
    ['1:30 PM', 48600, {}],
    ['1:30 am', 5400, {}],
  ])('reads %s as %s seconds into the day', (text, seconds, extra) => {
    expect(parseInput(text)).toEqual({ v: seconds / 86400, f: null, fmt: 'time', ...extra });
    expect(calc(`TIMEVALUE("${text}")`)).toBeCloseTo(seconds / 86400, 12);
  });

  it('rejects a 24-hour reading with a meridiem and letters that are not one', () => {
    expect(parseInput('13:30p').v).toBe('13:30p');
    expect(parseInput('0:30 a').v).toBe('0:30 a');
    expect(parseInput('1:30 pa').v).toBe('1:30 pa');
    expect(parseInput('1:30 x').v).toBe('1:30 x');
    expect(parseInput('1:30 pm.').v).toBe('1:30 pm.');
  });

  it('reads the meridiem after a date too and shows the time in 24-hour form', () => {
    expect(parseInput('1/15/2024 9:00 a')).toEqual({ v: 45306 + 9 / 24, f: null, fmt: 'datetime' });
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '1:30p');
    expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe('13:30');
  });
});
