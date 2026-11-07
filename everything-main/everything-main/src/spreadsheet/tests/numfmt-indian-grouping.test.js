import { afterEach, describe, expect, it } from 'vitest';
import { parseInput, formatValue, localeInfo, setLocale } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';

afterEach(() => setLocale('en-US'));

describe('Indian grouping', () => {
  it('is reported for en-IN and not for locales with three-digit groups', () => {
    expect(localeInfo('en-IN')).toMatchObject({ decimal: '.', group: ',', lakh: true });
    expect(localeInfo('en-US').lakh).toBe(false);
    expect(localeInfo('de-DE').lakh).toBe(false);
  });

  it('reads back the numbers en-IN displays', () => {
    setLocale('en-IN');
    expect(formatValue(1234567, { fmt: 'number', dec: 2 })).toBe('12,34,567.00');
    expect(parseInput('12,34,567')).toEqual({ v: 1234567, f: null, fmt: 'number' });
    expect(parseInput('12,34,567.50').v).toBe(1234567.5);
    expect(parseInput('1,00,000').v).toBe(100000);
    expect(parseInput('(12,34,567)').v).toBe(-1234567);
    expect(parseInput('12,34,567%').v).toBe(12345.67);
    expect(parseInput('1,234,567').v).toBe(1234567); // three-digit groups still read
    expect(parseInput('12,345').v).toBe(12345);
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, formatValue(1234567, { fmt: 'number', dec: 0 }));
    expect(wb.getValue(id, 0, 0)).toBe(1234567);
  });

  it('groups a custom #,##0 code as the Number format does, in two-digit groups past the first three', () => {
    setLocale('en-IN');
    expect(formatWithCode(1234567, '#,##0.00')).toBe('12,34,567.00');
    expect(formatWithCode(123456, '#,##0')).toBe('1,23,456');
    expect(formatWithCode(1234, '#,##0')).toBe('1,234');
    expect(formatWithCode(999, '#,##0')).toBe('999');
    expect(formatWithCode(-1234567.5, '#,##0.0;(#,##0.0)')).toBe('(12,34,567.5)');
    expect(formatWithCode(1234567, '"₹"#,##0')).toBe('₹12,34,567');
    setLocale('en-US');
    expect(formatWithCode(1234567, '#,##0.00')).toBe('1,234,567.00');
  });

  it('does not read two-digit groups where the locale never writes them', () => {
    expect(parseInput('12,34,567').v).toBe('12,34,567');
    expect(parseInput('1,00,000').v).toBe('1,00,000');
    expect(parseInput('1,0').v).toBe('1,0');
  });
});

describe('the rupee sign', () => {
  it('is read as INR, before or after the amount, in any locale', () => {
    expect(parseInput('₹5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'INR' });
    expect(parseInput('₹ 1,250.50')).toEqual({ v: 1250.5, f: null, fmt: 'currency', cur: 'INR' });
    expect(parseInput('(₹5)')).toEqual({ v: -5, f: null, fmt: 'currency', cur: 'INR' });
    expect(parseInput('-₹5').v).toBe(-5);
    expect(parseInput('5 ₹').cur).toBe('INR');
    setLocale('en-IN');
    expect(parseInput('₹12,34,567.50')).toEqual({ v: 1234567.5, f: null, fmt: 'currency', cur: 'INR' });
  });

  it('shows the typed amount as rupees', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    // A typed currency shows the decimals it was typed with, as a typed percent does.
    wb.setInput(id, 0, 0, '₹5');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'INR', dec: 0 });
    expect(wb.getDisplay(id, 0, 0)).toBe('₹5');
    wb.setInput(id, 1, 0, '₹5.50');
    expect(wb.getCell(id, 1, 0).s).toEqual({ fmt: 'currency', cur: 'INR', dec: 2 });
    expect(wb.getDisplay(id, 1, 0)).toBe('₹5.50');
  });
});
