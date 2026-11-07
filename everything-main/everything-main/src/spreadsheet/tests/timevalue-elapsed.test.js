import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// TIMEVALUE reads an elapsed time through the same parser typed cells use, wrapping its hours around
// the day, and keeps a limit of 9999 hours instead of wrapping any number of them.
describe('TIMEVALUE on elapsed times', () => {
  const value = (formula) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, formula);
    return wb.getValue(id, 0, 0);
  };

  it('wraps the hours of an elapsed time around the day', () => {
    expect(value('=TIMEVALUE("25:30")')).toBeCloseTo(1.5 / 24, 12); // 25:30 → 1:30
    expect(value('=TIMEVALUE("100:00:30")')).toBeCloseTo((4 * 3600 + 30) / 86400, 12); // 100 h = 4 days + 4 h
    expect(value('=TIMEVALUE("24:00")')).toBe(0);
  });

  it('still reads a bare hour with AM or PM, and an ordinary time', () => {
    expect(value('=TIMEVALUE("3 pm")')).toBeCloseTo(15 / 24, 12);
    expect(value('=TIMEVALUE("12 am")')).toBe(0);
    expect(value('=TIMEVALUE("1:30p")')).toBeCloseTo(13.5 / 24, 12);
  });

  it('refuses more than 9999 hours, and carries minutes past 59 over', () => {
    expect(value('=TIMEVALUE("10000:00")')).toEqual({ error: '#VALUE!' });
    expect(value('=TIMEVALUE("25:70")')).toBeCloseTo((2 * 3600 + 10 * 60) / 86400, 12); // 26:10, wrapped around the day
  });
});
