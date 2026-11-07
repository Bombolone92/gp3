import { afterEach, describe, expect, it } from 'vitest';
import { parseInput, localeInfo, setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => setLocale('en-US'));

describe('year-first locales', () => {
  it('report a year-first short date', () => {
    expect(localeInfo('ja-JP')).toMatchObject({ yearFirst: true, dayFirst: false });
    expect(localeInfo('en-US').yearFirst).toBe(false);
    expect(localeInfo('de-DE').yearFirst).toBe(false);
  });

  it.each(['ja-JP', 'zh-CN', 'ko-KR'].filter((loc) => localeInfo(loc).yearFirst))('read 24/1/1 as 2024-01-01 in %s', (loc) => {
    expect(parseInput('24/1/1', loc)).toEqual({ v: ymdToSerial(2024, 1, 1), f: null, fmt: 'date' });
    expect(parseInput('24/01/15', loc).v).toBe(ymdToSerial(2024, 1, 15));
    expect(parseInput('99/12/31', loc).v).toBe(ymdToSerial(1999, 12, 31));
    expect(parseInput('2024/1/1', loc).v).toBe(ymdToSerial(2024, 1, 1));
    expect(parseInput('24-1-1', loc).v).toBe(ymdToSerial(2024, 1, 1));
  });

  it('fall back to month/day/year when the first number cannot start a date', () => {
    expect(parseInput('1/15/24', 'ja-JP').v).toBe(ymdToSerial(2024, 1, 15));
    expect(parseInput('1/2', 'ja-JP').v).toBe(ymdToSerial(new Date().getFullYear(), 1, 2));
    expect(parseInput('24/13/1', 'ja-JP').v).toBe('24/13/1');
  });

  it('do not change how other locales read the same text', () => {
    // The year still comes last there, so the same text is the twenty-fourth of January 2001.
    expect(parseInput('24/1/1', 'en-US').v).toBe(ymdToSerial(2001, 1, 24));
    expect(parseInput('24/1/1', 'en-GB').v).toBe(ymdToSerial(2001, 1, 24));
    expect(parseInput('24.1.1', 'de-DE').v).toBe(ymdToSerial(2001, 1, 24));
    expect(parseInput('24/1/01', 'en-US').v).toBe(ymdToSerial(2001, 1, 24));
    expect(parseInput('24/1/01', 'en-GB').v).toBe(ymdToSerial(2001, 1, 24));
    expect(parseInput('24.1.01', 'de-DE').v).toBe(ymdToSerial(2001, 1, 24));
  });

  it('show the typed date back in a cell', () => {
    setLocale('ja-JP');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '24/1/1');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: ymdToSerial(2024, 1, 1), f: null, s: { fmt: 'date' } });
    expect(wb.getDisplay(id, 0, 0)).toBe('2024-01-01');
  });
});
