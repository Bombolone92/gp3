import { describe, it, expect } from 'vitest';
import { FONTS, fontStack, fontKeyFor } from '../src/core/format.js';

describe('fonts', () => {
  it('maps keys to stacks and family names back to keys', () => {
    expect(FONTS[0][0]).toBe('default');
    expect(fontStack('default')).toBeNull();
    expect(fontStack(null)).toBeNull();
    expect(fontStack('courier')).toContain('Courier New');
    expect(fontKeyFor('"Times New Roman", Times, serif')).toBe('times');
    expect(fontKeyFor('Arial')).toBe('arial');
    expect(fontKeyFor('Corbel')).toBe('corbel');
    expect(fontKeyFor('Source Sans Pro')).toBe('source-sans');
    expect(fontKeyFor('Nyala')).toBe('nyala');
    expect(fontKeyFor('Impact')).toBe('impact');
    expect(fontKeyFor('trebuchet')).toBe('font:trebuchet');
    expect(fontKeyFor('Tahoma')).toBe('tahoma');
    expect(fontKeyFor('Tahoma (Headings)')).toBe('tahoma');
    expect(fontKeyFor('Tahoma (Body)')).toBe('tahoma');
    expect(fontKeyFor('menlo')).toBe('font:menlo');
    expect(fontKeyFor('Papyrus')).toBe('font:Papyrus');
  });
});
import {
  setLocale, localeInfo, LOCALES,
  parseInput, formatValue, formatGeneral, editText, ymdToSerial, serialToYMD, dateToSerial,
  styleToNumFmt, numFmtToStyle, defaultAlign,
} from '../src/core/format.js';

describe('parseInput', () => {
  it('infers numbers, booleans, formulas, and text', () => {
    expect(parseInput('42')).toEqual({ v: 42, f: null, fmt: null });
    expect(parseInput(' -3.5 ')).toEqual({ v: -3.5, f: null, fmt: null });
    expect(parseInput('1,250.75')).toEqual({ v: 1250.75, f: null, fmt: 'number' }); // typed separators ask for the grouped format
    expect(parseInput('1e3')).toEqual({ v: 1000, f: null, fmt: 'scientific' }); // E notation asks for the Scientific format
    expect(parseInput('true')).toEqual({ v: true, f: null, fmt: null });
    expect(parseInput('=A1+1')).toEqual({ v: null, f: 'A1+1', fmt: null });
    expect(parseInput('hello')).toEqual({ v: 'hello', f: null, fmt: null });
    expect(parseInput('')).toEqual({ v: null, f: null, fmt: null });
    expect(parseInput('=')).toEqual({ v: '=', f: null, fmt: null });
  });

  it('turns percents and currency into numbers with a format', () => {
    expect(parseInput('12%')).toEqual({ v: 0.12, f: null, fmt: 'percent' });
    expect(parseInput('$1,200')).toEqual({ v: 1200, f: null, fmt: 'currency', cur: 'USD' });
    expect(parseInput('-$5.50')).toEqual({ v: -5.5, f: null, fmt: 'currency', cur: 'USD' });
    expect(parseInput('%')).toEqual({ v: '%', f: null, fmt: null });
  });

  it('recognizes ISO and US dates as serials', () => {
    expect(parseInput('2024-01-15')).toEqual({ v: 45306, f: null, fmt: 'date' });
    expect(parseInput('1/15/2024')).toEqual({ v: 45306, f: null, fmt: 'date' });
    expect(parseInput('2024-02-30').fmt).toBeNull();
  });

  it('reads written-out, day-first, two-digit-year, and yearless dates', () => {
    const year = new Date().getFullYear();
    expect(parseInput('Aug 28, 2026')).toEqual({ v: 46262, f: null, fmt: 'date', dateStyle: 'medium' });
    expect(parseInput('28 Aug 2026')).toEqual({ v: 46262, f: null, fmt: 'date', dateStyle: 'medium' });
    expect(parseInput('28-Aug-26').v).toBe(46262);
    expect(parseInput('Sept 3 2025').v).toBe(45903);
    expect(parseInput('August 28').v).toBe(ymdToSerial(year, 8, 28));
    expect(parseInput('8/28').v).toBe(ymdToSerial(year, 8, 28));
    expect(parseInput('8/28/26')).toEqual({ v: 46262, f: null, fmt: 'date' });
    expect(parseInput('28/8/2026').v).toBe(46262);
    expect(parseInput('2026/8/28').v).toBe(46262);
    expect(parseInput('8-28-2026').v).toBe(46262);
    expect(parseInput('Aug 28, 2026 3:45 pm')).toEqual({ v: 46262.65625, f: null, fmt: 'datetime' });
    expect(parseInput('13/14/2026').v).toBe('13/14/2026');
    expect(parseInput('May').v).toBe('May');
    expect(parseInput('Mar-2026').v).toBe(ymdToSerial(2026, 3, 1)); // a month and year is the first of that month
  });

  it('reads accounting negatives and spaced currency', () => {
    expect(parseInput('(1,234)')).toEqual({ v: -1234, f: null, fmt: 'number' });
    expect(parseInput('($1,234.50)')).toEqual({ v: -1234.5, f: null, fmt: 'currency', cur: 'USD' });
    expect(parseInput('$ 1,200')).toEqual({ v: 1200, f: null, fmt: 'currency', cur: 'USD' });
    expect(parseInput('\u22125')).toEqual({ v: -5, f: null, fmt: null });
    expect(parseInput('(-5)').v).toBe('(-5)');
  });

  it('keeps text behind a leading apostrophe', () => {
    expect(parseInput("'123")).toEqual({ v: '123', f: null, fmt: 'text' });
  });

  it('does not treat mostly-text as numbers', () => {
    expect(parseInput('12 apples').v).toBe('12 apples');
    expect(parseInput('1-2').v).toBe('1-2');
  });
});

describe('date serials', () => {
  it('uses Excel’s 1900 calendar and preserves modern serials', () => {
    expect(ymdToSerial(1900, 1, 1)).toBe(1);
    expect(ymdToSerial(2000, 1, 1)).toBe(36526);
    expect(serialToYMD(45306)).toMatchObject({ y: 2024, m: 1, d: 15 });
    expect(dateToSerial(new Date(Date.UTC(2024, 0, 15)))).toBe(45306);
  });

  it('overflows months as DATE() does', () => {
    expect(serialToYMD(ymdToSerial(2024, 13, 1))).toMatchObject({ y: 2025, m: 1, d: 1 });
    expect(serialToYMD(ymdToSerial(2024, 3, 0))).toMatchObject({ y: 2024, m: 2, d: 29 });
  });
});

describe('formatValue', () => {
  it('formats general numbers without noise', () => {
    expect(formatGeneral(0.1 + 0.2)).toBe('0.3');
    expect(formatGeneral(1234567)).toBe('1234567');
    expect(formatGeneral(1 / 3)).toBe('0.333333333');
    expect(formatGeneral(1e20)).toBe('1E+20');
    expect(formatGeneral(-2.5)).toBe('-2.5');
  });

  it('applies number formats', () => {
    expect(formatValue(1234.5, { fmt: 'number', dec: 2 })).toBe('1,234.50');
    expect(formatValue(1234.5, { fmt: 'number', dec: 0 })).toBe('1,235');
    expect(formatValue(0.125, { fmt: 'percent', dec: 1 })).toBe('12.5%');
    expect(formatValue(9.5, { fmt: 'currency', dec: 2 })).toBe('$9.50');
    expect(formatValue(9.5, { fmt: 'currency', dec: 2, cur: 'EUR' })).toBe('€9.50');
    expect(formatValue(45306, { fmt: 'date' })).toBe('2024-01-15');
  });

  it('formats booleans, errors, and empties', () => {
    expect(formatValue(true)).toBe('TRUE');
    expect(formatValue({ error: '#DIV/0!' })).toBe('#DIV/0!');
    expect(formatValue(null)).toBe('');
    expect(formatValue('text', { fmt: 'number' })).toBe('text');
  });

  it('picks alignment by type', () => {
    expect(defaultAlign(1)).toBe('right');
    expect(defaultAlign('a')).toBe('left');
    expect(defaultAlign(true)).toBe('center');
  });
});

describe('editText', () => {
  it('represents literal errors as their codes, which read back as the same errors, without treating them as numbers', () => {
    for (const error of ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']) {
      const text = editText({ v: { error }, f: null });
      expect(text).toBe(error);
      expect(parseInput(text)).toEqual({ v: { error }, f: null, fmt: null });
    }
    // An error a typed cell cannot spell edits as a formula literal, so committing the edit keeps an error, not text.
    expect(editText({ v: { error: '#SPILL!' }, f: null })).toBe('=#SPILL!');
    expect(parseInput('=#SPILL!')).toMatchObject({ v: null, f: '#SPILL!' });
    expect(editText({ v: '#DIV/0!', f: null })).toBe("'#DIV/0!"); // literal text gets the apostrophe that keeps it text
  });

  it('shows formulas with "=" and values as typed', () => {
    expect(editText({ v: null, f: 'SUM(A1:A2)' })).toBe('=SUM(A1:A2)');
    expect(editText({ v: 0.25, s: { fmt: 'percent' } })).toBe('25%');
    expect(editText({ v: 45306, s: { fmt: 'date' } })).toBe('2024-01-15');
    expect(editText({ v: 'hello' })).toBe('hello');
    expect(editText({ v: '123' })).toBe("'123");
    expect(editText({ v: false })).toBe('FALSE');
    expect(editText(null)).toBe('');
  });
});

describe('number format codes', () => {
  it('maps styles to codes and back', () => {
    expect(styleToNumFmt({ fmt: 'number', dec: 2 })).toBe('#,##0.00');
    expect(styleToNumFmt({ fmt: 'percent', dec: 0 })).toBe('#,##0%');
    expect(styleToNumFmt({ fmt: 'currency', dec: 2, cur: 'EUR' })).toBe('"€"#,##0.00');
    expect(styleToNumFmt({ fmt: 'date' })).toBe('yyyy-mm-dd');
    expect(numFmtToStyle('#,##0.00')).toEqual({ fmt: 'number', dec: 2, group: true });
    expect(numFmtToStyle('0.0%')).toEqual({ fmt: 'percent', dec: 1, group: false });
    expect(numFmtToStyle('"$"#,##0.00')).toEqual({ fmt: 'currency', dec: 2, cur: 'USD' });
    expect(numFmtToStyle('m/d/yy')).toEqual({ fmt: 'custom', code: 'm/d/yy' });
    expect(numFmtToStyle('yyyy-mm-dd')).toEqual({ fmt: 'date' });
    expect(numFmtToStyle('@')).toEqual({ fmt: 'text' });
    expect(numFmtToStyle('General')).toBeNull();
  });
});

describe('time, date-time, and scientific formats', () => {
  it('parses times and date-times as serials', () => {
    expect(parseInput('13:45')).toEqual({ v: 0.5729166666666666, f: null, fmt: 'time' });
    expect(parseInput('1:45 pm').v).toBeCloseTo(13.75 / 24);
    expect(parseInput('12:00 am').v).toBe(0);
    expect(parseInput('09:05:30').v).toBeCloseTo((9 * 3600 + 5 * 60 + 30) / 86400);
    expect(parseInput('25:00')).toEqual({ v: (25 * 3600) / 86400, f: null, fmt: 'custom', code: '[h]:mm:ss' }); // an elapsed time
    expect(parseInput('13:45 pm').v).toBe('13:45 pm');
    const dt = parseInput('2024-01-15 13:45');
    expect(dt.fmt).toBe('datetime');
    expect(dt.v).toBeCloseTo(45306 + 0.5729166666);
    expect(parseInput('1/15/2024 9:00 AM').fmt).toBe('datetime');
  });

  it('formats them back', () => {
    expect(formatValue(0.5729166666666666, { fmt: 'time' })).toBe('13:45');
    expect(formatValue(45306.75, { fmt: 'time', sec: true })).toBe('18:00:00');
    expect(formatValue(45306.75, { fmt: 'datetime' })).toBe('2024-01-15 18:00');
    expect(formatValue(45306, { fmt: 'date', dateStyle: 'medium' })).toBe('Jan 15, 2024');
    expect(formatValue(45306, { fmt: 'date', dateStyle: 'long' })).toBe('January 15, 2024');
    expect(formatValue(1234.5, { fmt: 'scientific', dec: 2 })).toBe('1.23E+03');
    expect(formatValue(0.00012, { fmt: 'scientific', dec: 1 })).toBe('1.2E-04');
    expect(formatValue(1234.5, { fmt: 'number', dec: 1, group: false })).toBe('1234.5');
    expect(formatValue(9.5, { fmt: 'currency', dec: 2, cur: 'GBP' })).toBe('£9.50');
    expect(editText({ v: 45306.75, s: { fmt: 'datetime' } })).toBe('2024-01-15 18:00:00');
    expect(editText({ v: 0.5, s: { fmt: 'time' } })).toBe('12:00:00');
  });

  it('maps to and from number-format codes', () => {
    expect(styleToNumFmt({ fmt: 'time' })).toBe('hh:mm');
    expect(styleToNumFmt({ fmt: 'datetime', sec: true })).toBe('yyyy-mm-dd hh:mm:ss');
    expect(styleToNumFmt({ fmt: 'scientific', dec: 2 })).toBe('0.00E+00');
    expect(styleToNumFmt({ fmt: 'date', dateStyle: 'medium' })).toBe('mmm d, yyyy');
    expect(numFmtToStyle('h:mm')).toEqual({ fmt: 'custom', code: 'h:mm' });
    expect(numFmtToStyle('h:mm:ss AM/PM')).toEqual({ fmt: 'custom', code: 'h:mm:ss AM/PM' });
    expect(numFmtToStyle('m/d/yy h:mm')).toEqual({ fmt: 'custom', code: 'm/d/yy h:mm' });
    expect(numFmtToStyle('0.00E+00')).toEqual({ fmt: 'scientific', dec: 2 });
    expect(numFmtToStyle('mmm d, yyyy')).toEqual({ fmt: 'date', dateStyle: 'medium' });
    expect(numFmtToStyle('mmmm d, yyyy')).toEqual({ fmt: 'date', dateStyle: 'long' });
  });
});

describe('border css', () => {
  it('maps styles to width and line style', async () => {
    const { borderCss, BORDER_STYLES } = await import('../src/core/format.js');
    expect(borderCss({})).toEqual({ width: '1px', style: 'solid', color: null });
    expect(borderCss({ bs: 'medium', bc: '#ff0000' })).toEqual({ width: '2px', style: 'solid', color: '#ff0000' });
    expect(borderCss({ bs: 'thick' }).width).toBe('3px');
    expect(borderCss({ bs: 'dashed' }).style).toBe('dashed');
    expect(borderCss({ bs: 'dotted' }).style).toBe('dotted');
    expect(borderCss({ bs: 'double' })).toEqual({ width: '3px', style: 'double', color: null });
    expect(BORDER_STYLES.map(([k]) => k)).toContain('thin');
  });
});

describe('format presets', () => {
  it('accounting, fraction, and duration codes render', async () => {
    const { formatWithCode } = await import('../src/core/numfmt.js');
    const { ACCOUNTING_CODE, FRACTION_CODE, DURATION_CODE } = await import('../src/ui/toolbar.js');
    expect(formatWithCode(1234.5, ACCOUNTING_CODE)).toBe(' $1,234.50 ');
    expect(formatWithCode(-1234.5, ACCOUNTING_CODE)).toBe(' $(1,234.50)');
    expect(formatWithCode(0, ACCOUNTING_CODE)).toBe(' $-   ');
    expect(formatWithCode(1234.5, FRACTION_CODE)).toBe('1234 1/2');
    expect(formatWithCode(0.75, FRACTION_CODE)).toBe(' 3/4');
    expect(formatWithCode(0.75, '0 ?/?')).toBe('0 3/4');
    expect(formatWithCode(2, FRACTION_CODE)).toBe('2    ');
    expect(formatWithCode(1.0625, DURATION_CODE)).toBe('25:30:00');
    expect(formatWithCode(30.5, DURATION_CODE)).toBe('732:00:00');
  });
});

describe('error help', () => {
  it('explains every error code the engine produces', async () => {
    const { errorHelp, ERROR_HELP } = await import('../src/core/format.js');
    for (const code of ['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#N/A', '#NUM!', '#CYCLE!', '#SPILL!', '#CALC!', '#ERROR!']) {
      expect(ERROR_HELP[code]).toBeTruthy();
      expect(errorHelp(code).startsWith(`${code}: `)).toBe(true);
    }
    expect(errorHelp('#WEIRD!')).toBe('#WEIRD!');
  });
});

describe('regional formats', () => {
  it('knows each locale\'s separators and date order', () => {
    expect(localeInfo('en-US')).toMatchObject({ decimal: '.', group: ',', dayFirst: false });
    expect(localeInfo('de-DE')).toMatchObject({ decimal: ',', group: '.', dayFirst: true });
    expect(localeInfo('en-GB')).toMatchObject({ decimal: '.', dayFirst: true });
    expect(LOCALES.length).toBeGreaterThan(10);
  });

  it('reads comma decimals, dotted dates, and day-first dates under a German locale', () => {
    expect(parseInput('1,5', 'de-DE')).toEqual({ v: 1.5, f: null, fmt: null });
    expect(parseInput('1.234,5', 'de-DE')).toEqual({ v: 1234.5, f: null, fmt: 'number' });
    expect(parseInput('12,5%', 'de-DE')).toEqual({ v: 0.125, f: null, fmt: 'percent' });
    expect(parseInput('12,50 €', 'de-DE')).toEqual({ v: 12.5, f: null, fmt: 'currency', cur: 'EUR' });
    expect(parseInput('28.8.2026', 'de-DE')).toEqual({ v: 46262, f: null, fmt: 'date' });
    expect(parseInput('1/2/2026', 'de-DE').v).toBe(ymdToSerial(2026, 2, 1)); // day first
    expect(parseInput('1/2/2026', 'en-GB').v).toBe(ymdToSerial(2026, 2, 1));
    expect(parseInput('1/2/2026', 'en-US').v).toBe(ymdToSerial(2026, 1, 2));
    expect(parseInput('1.5', 'en-US')).toEqual({ v: 1.5, f: null, fmt: null });
    expect(parseInput('1,250.75', 'en-US').v).toBe(1250.75);
  });

  it('shows general numbers, custom codes, and CSV with the locale\'s marks', async () => {
    const { formatWithCode } = await import('../src/core/numfmt.js');
    const { Workbook } = await import('../src/core/workbook.js');
    const { sheetToCsv } = await import('../src/core/io.js');
    setLocale('de-DE');
    try {
      expect(formatGeneral(3.5)).toBe('3,5');
      expect(formatGeneral(12)).toBe('12');
      expect(formatWithCode(1234.5, '#,##0.00')).toBe('1.234,50');
      expect(formatValue(1234.5, { fmt: 'number', dec: 1 })).toBe('1.234,5');
      const wb = new Workbook();
      const id = wb.sheets[0].id;
      wb.setInput(id, 0, 0, '1,5');
      wb.setInput(id, 0, 1, 'a;b');
      expect(wb.getValue(id, 0, 0)).toBe(1.5);
      expect(sheetToCsv(wb, id)).toBe('\ufeff1,5;"a;b"\r\n');
    } finally {
      setLocale('en-US');
    }
    expect(formatGeneral(3.5)).toBe('3.5');
    expect(setLocale('xx-XX')).toBeUndefined();
    expect(formatGeneral(3.5)).toBe('3.5');
  });
});
