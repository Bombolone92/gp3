import { describe, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';

// For every comma of a format code the engine searched the tokens before it for a digit and the tokens after it
// for the next digit-like one, for every m token the date letters on either side, and with an exponent every
// fraction placeholder's position: each search cost the code's length, so a code of thirty thousand commas or
// fifteen thousand m tokens, which TEXT(x, REPT(",", 30000)) hands the engine on every recalculation, took over
// a second. Each of these is now read in one pass over the code.
const SERIAL = 45000.5; // 2023-03-15 12:00:00
const TIME_LIMIT_MS = 1500; // the long codes below cost 2 to 25 seconds through the searches, tens of milliseconds without

describe('commas, m tokens and exponent fractions keep their meaning', () => {
  it('groups by a comma between digits and scales by a trailing one', () => {
    expect(formatWithCode(1234567, '#,##0')).toBe('1,234,567');
    expect(formatWithCode(1234567, '#,##0.0,')).toBe('1,234.6');
    expect(formatWithCode(1234567, '#,##0,,"M"')).toBe('1M');
    expect(formatWithCode(1234567, '#,')).toBe('1235');
    expect(formatWithCode(1234567, '0,000,')).toBe('1,235');
    expect(formatWithCode(1234567, ',0')).toBe(',1234567'); // a leading comma is literal
    expect(formatWithCode(0.5, '0,%')).toBe('0%'); // a comma before a percent sign scales
    expect(formatWithCode(1234.5, '0.00,E+00')).toBe('1.23E+03');
  });

  it('reads m as minutes beside h or s and as the month elsewhere, after ss included', () => {
    expect(formatWithCode(SERIAL, 'hh:mm:ss mm/dd')).toBe('12:00:00 03/15');
    expect(formatWithCode(SERIAL, 'm/d/yyyy h:mm')).toBe('3/15/2023 12:00');
    expect(formatWithCode(SERIAL, 'yyyy-mm-dd hh:mm:ss mm')).toBe('2023-03-15 12:00:00 03');
    expect(formatWithCode(SERIAL, 'h m')).toBe('12 0');
    expect(formatWithCode(SERIAL, 'm s')).toBe('0 0');
    expect(formatWithCode(SERIAL, 'mm:ss')).toBe('00:00');
    expect(formatWithCode(SERIAL, 'm')).toBe('3');
    expect(formatWithCode(SERIAL, 'mm mm')).toBe('03 03');
    expect(formatWithCode(SERIAL, 'mmm-yy')).toBe('Mar-23');
    expect(formatWithCode(1.5, '[h] m')).toBe('36 0');
    expect(formatWithCode(SERIAL, 'd m s')).toBe('15 0 0');
  });

  it('places the fraction placeholders before an exponent', () => {
    expect(formatWithCode(1234.56, '0.000E+00')).toBe('1.235E+03');
    expect(formatWithCode(1.5, '0.0000E+00')).toBe('1.5000E+00');
    expect(formatWithCode(0.00012345, '##0.0E+0')).toBe('123.5E-6');
    expect(formatWithCode(1234.5, '0.00E+00 "x"')).toBe('1.23E+03 x');
  });
});

describe('a code of many commas, m tokens or fraction placeholders', () => {
  it('formats in a moment', { timeout: 60000 }, () => {
    const timed = (fn) => { const start = performance.now(); const out = fn(); return { out, ms: performance.now() - start }; };
    const commas = timed(() => formatWithCode(1, `0${','.repeat(100000)}`));
    expect(commas.out).toBe('0');
    expect(commas.ms).toBeLessThan(TIME_LIMIT_MS);
    // Fifty thousand zero placeholders group from the right, so the first group has two.
    const grouped = timed(() => formatWithCode(1234567, ',0'.repeat(50000)));
    expect(grouped.out.startsWith(',00,000,000,')).toBe(true);
    expect(grouped.out.endsWith('1,234,567')).toBe(true);
    expect(grouped.ms).toBeLessThan(TIME_LIMIT_MS);
    const months = timed(() => formatWithCode(SERIAL, 'm '.repeat(100000)));
    expect(months.out.startsWith('3 3 3 ')).toBe(true);
    expect(months.ms).toBeLessThan(TIME_LIMIT_MS);
    // Only the m right after the h is minutes; each later one follows an m, so it is the month again.
    const minutes = timed(() => formatWithCode(SERIAL, `h ${'m '.repeat(100000)}`));
    expect(minutes.out.startsWith('12 0 3 3 ')).toBe(true);
    expect(minutes.ms).toBeLessThan(TIME_LIMIT_MS);
    const fraction = timed(() => formatWithCode(1.5, `0.${'0'.repeat(200000)}E+00`));
    expect(fraction.out.startsWith('1.5000')).toBe(true);
    expect(fraction.out.endsWith('E+00')).toBe(true);
    expect(fraction.ms).toBeLessThan(TIME_LIMIT_MS);
    const exponent = timed(() => formatWithCode(1.5, `0E+${'0'.repeat(200000)}`));
    expect(exponent.out).toBe(`2E+${'0'.repeat(200000)}`);
    expect(exponent.ms).toBeLessThan(TIME_LIMIT_MS);
  });
});
